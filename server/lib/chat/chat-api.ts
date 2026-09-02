import { RouterContext } from '@koa/router'
import httpErrors from 'http-errors'
import Joi from 'joi'
import Koa, { ExtendableContext, Next } from 'koa'
import { assertUnreachable } from '../../../common/assert-unreachable'
import {
  CHANNEL_BANS_LIMIT,
  CHANNEL_USER_PERMISSIONS_LIMIT,
  ChannelPermissions,
  ChatServiceErrorCode,
  EditChannelRequest,
  EditChannelResponse,
  GetBatchedChannelInfosResponse,
  GetChannelHistoryServerResponse,
  GetChannelInfoResponse,
  GetChannelUserPermissionsResponse,
  GetChatUserProfileResponse,
  InitialChannelData,
  JoinChannelResponse,
  ListChannelBansResponse,
  ListUserChannelEntriesResponse,
  MarkChannelReadRequest,
  ModerateChannelUserServerRequest,
  SEARCH_CHANNELS_LIMIT,
  SbChannelId,
  SearchChannelsResponse,
  SendChatMessageServerRequest,
  TransferChannelOwnershipRequest,
  UpdateChannelUserPermissionsRequest,
  UpdateChannelUserPreferencesRequest,
} from '../../../common/chat'
import { CHANNEL_MAXLENGTH, CHANNEL_PATTERN } from '../../../common/constants'
import { MAX_IMAGE_SIZE_BYTES } from '../../../common/images'
import { SbUser } from '../../../common/users/sb-user'
import { SbUserId } from '../../../common/users/sb-user-id'
import { asHttpError } from '../errors/error-with-payload'
import { handleMultipartFiles } from '../files/handle-multipart-files'
import { httpApi, httpBeforeAll } from '../http/http-api'
import { httpBefore, httpDelete, httpGet, httpPatch, httpPost } from '../http/route-decorators'
import { checkAllPermissions } from '../permissions/check-permissions'
import ensureLoggedIn from '../session/ensure-logged-in'
import createThrottle from '../throttle/create-throttle'
import throttleMiddleware, { throttleByUser, throttleMiddlewareFunc } from '../throttle/middleware'
import { joiTimestampMillis } from '../validation/joi-timestamp'
import { validateRequest } from '../validation/joi-validator'
import { json } from '../validation/json-validator'
import ChatService, { ChatServiceError } from './chat-service'

const getJoinedChannelsThrottle = createThrottle('chatgetjoinedchannels', {
  rate: 10,
  burst: 20,
  window: 60000,
})

const joinThrottle = createThrottle('chatjoin', {
  rate: 3,
  burst: 10,
  window: 60000,
})

const editThrottle = createThrottle('chatedit', {
  rate: 20,
  burst: 30,
  window: 60000,
})

const editImageThrottle = createThrottle('chateditimage', {
  rate: 3,
  burst: 12,
  window: 60000,
})

const leaveThrottle = createThrottle('chatleave', {
  rate: 10,
  burst: 20,
  window: 60000,
})

const sendThrottle = createThrottle('chatsend', {
  rate: 30,
  burst: 90,
  window: 60000,
})

const retrievalThrottle = createThrottle('chatretrieval', {
  rate: 30,
  burst: 120,
  window: 60000,
})

const channelRetrievalThrottle = createThrottle('channelretrieval', {
  rate: 50,
  burst: 150,
  window: 60000,
})

const kickBanThrottle = createThrottle('chatkickban', {
  rate: 20,
  burst: 60,
  window: 60000,
})

const transferOwnershipThrottle = createThrottle('chattransferownership', {
  rate: 5,
  burst: 10,
  window: 60000,
})

const getUserProfileThrottle = createThrottle('chatgetuserprofile', {
  rate: 40,
  burst: 80,
  window: 60000,
})

const userPermissionsThrottle = createThrottle('chatuserpermissions', {
  rate: 20,
  burst: 40,
  window: 60000,
})

// Listing user channel entries is driven by a debounced search box, so it issues far more requests
// than the permission read/write endpoints do and needs a correspondingly higher limit (similar to
// the channel search throttle).
const userChannelEntriesThrottle = createThrottle('chatuserchannelentries', {
  rate: 40,
  burst: 120,
  window: 60000,
})

const userPreferencesThrottle = createThrottle('chatuserpreferences', {
  rate: 20,
  burst: 40,
  window: 60000,
})

const markReadThrottle = createThrottle('chatmarkread', {
  rate: 30,
  burst: 60,
  window: 60000,
})

// Listing channel bans is driven by a debounced search box, so it issues far more requests than
// the moderation endpoints do and needs a correspondingly higher limit (similar to
// `userChannelEntriesThrottle`).
const channelBansThrottle = createThrottle('chatchannelbans', {
  rate: 40,
  burst: 120,
  window: 60000,
})

const joiSerialId = () => Joi.number().min(1)
const channelNameSchema = () => Joi.string().max(CHANNEL_MAXLENGTH).pattern(CHANNEL_PATTERN)

const channelIdParamsSchema = () =>
  Joi.object<{ channelId: SbChannelId }>({
    channelId: joiSerialId().required(),
  })

const channelUserParamsSchema = () =>
  Joi.object<{ channelId: SbChannelId; targetId: SbUserId }>({
    channelId: joiSerialId().required(),
    targetId: joiSerialId().required(),
  })

const editChannelBodySchema = () =>
  Joi.object<{ channelChanges: EditChannelRequest }>({
    channelChanges: json.object({
      description: Joi.string().allow(null),
      topic: Joi.string().allow(null),
      deleteBanner: Joi.boolean(),
      deleteBadge: Joi.boolean(),
    }),
  })

const moderateChannelUserBodySchema = () =>
  Joi.object<ModerateChannelUserServerRequest>({
    moderationAction: Joi.string().valid('kick', 'ban').required(),
    moderationReason: Joi.string().allow(''),
  })

const transferChannelOwnershipBodySchema = () =>
  Joi.object<TransferChannelOwnershipRequest>({
    targetId: joiSerialId().required(),
  })

const channelUserPermissionsBodySchema = () =>
  Joi.object<UpdateChannelUserPermissionsRequest>({
    permissions: Joi.object<ChannelPermissions>({
      kick: Joi.boolean().required(),
      ban: Joi.boolean().required(),
      changeTopic: Joi.boolean().required(),
      togglePrivate: Joi.boolean().required(),
      editPermissions: Joi.boolean().required(),
    }).required(),
  })

const searchListQuerySchema = () =>
  Joi.object<{ q?: string; offset: number }>({
    q: Joi.string().allow(''),
    offset: Joi.number().min(0),
  })

function convertChatServiceError(err: unknown) {
  if (!(err instanceof ChatServiceError)) {
    throw err
  }

  switch (err.code) {
    case ChatServiceErrorCode.ChannelNotFound:
    case ChatServiceErrorCode.NotInChannel:
    case ChatServiceErrorCode.TargetNotBanned:
    case ChatServiceErrorCode.TargetNotInChannel:
    case ChatServiceErrorCode.UserOffline:
    case ChatServiceErrorCode.UserNotFound:
      throw asHttpError(404, err)
    case ChatServiceErrorCode.CannotModerateYourself:
    case ChatServiceErrorCode.InappropriateImage:
    case ChatServiceErrorCode.NoInitialChannelData:
      throw asHttpError(400, err)
    case ChatServiceErrorCode.CannotChangeChannelOwner:
    case ChatServiceErrorCode.CannotEditChannel:
    case ChatServiceErrorCode.CannotModerateChannelOwner:
    case ChatServiceErrorCode.CannotModerateChannelModerator:
    case ChatServiceErrorCode.MaximumJoinedChannels:
    case ChatServiceErrorCode.MaximumOwnedChannels:
    case ChatServiceErrorCode.NotEnoughPermissions:
    case ChatServiceErrorCode.UserBanned:
    case ChatServiceErrorCode.UserChatRestricted:
      throw asHttpError(403, err)
    default:
      assertUnreachable(err.code)
  }
}

async function convertChatServiceErrors(ctx: RouterContext, next: Koa.Next) {
  try {
    await next()
  } catch (err) {
    convertChatServiceError(err)
  }
}

function getValidatedChannelId(ctx: RouterContext) {
  const {
    params: { channelId },
  } = validateRequest(ctx, {
    params: channelIdParamsSchema(),
  })

  return channelId
}

/**
 * Retrieves the banner/badge files from a multipart channel edit request, ensuring at most one of
 * each was uploaded.
 */
function getValidatedChannelImageFiles(ctx: RouterContext) {
  const bannerFile = ctx.request.files?.banner
  const badgeFile = ctx.request.files?.badge
  if ((bannerFile && Array.isArray(bannerFile)) || (badgeFile && Array.isArray(badgeFile))) {
    throw new httpErrors.BadRequest('only one banner/badge file can be uploaded')
  }

  return { bannerFile, badgeFile }
}

/**
 * Returns whether the requesting user holds the server-wide `moderateChatChannels` permission,
 * which gives them the channel owner's authority in every channel.
 */
function isServerModerator(ctx: RouterContext): boolean {
  return !!ctx.session?.permissions.moderateChatChannels
}

async function throttleEditChannel(ctx: ExtendableContext, next: Next) {
  const throttle =
    ctx.request.files?.banner || ctx.request.files?.badge ? editImageThrottle : editThrottle

  await throttleMiddlewareFunc(throttle, throttleByUser, ctx, next)
}

@httpApi('/chat')
@httpBeforeAll(ensureLoggedIn, convertChatServiceErrors)
export class ChatApi {
  constructor(private chatService: ChatService) {}

  @httpGet('/joined-channels')
  @httpBefore(throttleMiddleware(getJoinedChannelsThrottle, throttleByUser))
  async getJoinedChannels(ctx: RouterContext): Promise<InitialChannelData[]> {
    return await this.chatService.getJoinedChannels(ctx.session!.user.id)
  }

  @httpPost('/join/:channelName')
  @httpBefore(throttleMiddleware(joinThrottle, throttleByUser))
  async joinChannel(ctx: RouterContext): Promise<JoinChannelResponse> {
    const {
      params: { channelName },
    } = validateRequest(ctx, {
      params: Joi.object<{ channelName: string }>({
        channelName: channelNameSchema().required(),
      }),
    })

    return await this.chatService.joinChannel(channelName, ctx.session!.user.id)
  }

  @httpPatch('/:channelId')
  @httpBefore(handleMultipartFiles(MAX_IMAGE_SIZE_BYTES), throttleEditChannel)
  async editChannel(ctx: RouterContext): Promise<EditChannelResponse> {
    const channelId = getValidatedChannelId(ctx)
    const {
      body: { channelChanges },
    } = validateRequest(ctx, {
      body: editChannelBodySchema(),
    })
    const { bannerFile, badgeFile } = getValidatedChannelImageFiles(ctx)

    return await this.chatService.editChannel({
      channelId,
      userId: ctx.session!.user.id,
      isServerModerator: isServerModerator(ctx),
      updates: channelChanges,
      bannerFile,
      badgeFile,
    })
  }

  @httpDelete('/:channelId')
  @httpBefore(throttleMiddleware(leaveThrottle, throttleByUser))
  async leaveChannel(ctx: RouterContext): Promise<void> {
    const channelId = getValidatedChannelId(ctx)

    await this.chatService.leaveChannel(channelId, ctx.session!.user.id)

    ctx.status = 204
  }

  @httpPost('/:channelId/messages')
  @httpBefore(throttleMiddleware(sendThrottle, throttleByUser))
  async sendChatMessage(ctx: RouterContext): Promise<void> {
    const channelId = getValidatedChannelId(ctx)
    const {
      body: { message },
    } = validateRequest(ctx, {
      body: Joi.object<SendChatMessageServerRequest>({
        message: Joi.string().min(1).required(),
      }),
    })

    await this.chatService.sendChatMessage(channelId, ctx.session!.user.id, message)

    ctx.status = 204
  }

  /**
   * @deprecated This API was last used in version 7.1.4. Use `/:channelId/messages2` instead.
   */
  @httpGet('/:channelName/messages')
  @httpBefore(throttleMiddleware(retrievalThrottle, throttleByUser))
  getChannelHistoryOld(ctx: RouterContext) {
    return []
  }

  @httpGet('/:channelId/messages2')
  @httpBefore(throttleMiddleware(retrievalThrottle, throttleByUser))
  async getChannelHistory(ctx: RouterContext): Promise<GetChannelHistoryServerResponse> {
    const channelId = getValidatedChannelId(ctx)
    const {
      query: { limit, beforeTime, afterTime, aroundTime },
    } = validateRequest(ctx, {
      query: Joi.object<{
        limit: number
        beforeTime?: number
        afterTime?: number
        aroundTime?: number
      }>({
        limit: Joi.number().min(1).max(100),
        beforeTime: joiTimestampMillis().min(-1),
        afterTime: joiTimestampMillis().min(0),
        aroundTime: joiTimestampMillis().min(0),
      }).oxor('beforeTime', 'afterTime', 'aroundTime'),
    })

    return await this.chatService.getChannelHistory({
      channelId,
      userId: ctx.session!.user.id,
      limit,
      beforeTime,
      afterTime,
      aroundTime,
    })
  }

  /**
   * @deprecated This API was last used in version 7.1.7. Use `/:channelId/users2` instead.
   */
  @httpGet('/:channelName/users')
  @httpBefore(throttleMiddleware(retrievalThrottle, throttleByUser))
  async getChannelUsersOld(ctx: RouterContext) {
    return []
  }

  @httpGet('/:channelId/users2')
  @httpBefore(throttleMiddleware(retrievalThrottle, throttleByUser))
  async getChannelUsers(ctx: RouterContext): Promise<SbUser[]> {
    const channelId = getValidatedChannelId(ctx)
    return await this.chatService.getChannelUsers({ channelId, userId: ctx.session!.user.id })
  }

  @httpPost('/:channelId/user-preferences')
  @httpBefore(throttleMiddleware(userPreferencesThrottle, throttleByUser))
  async updateChannelUserPreferences(ctx: RouterContext): Promise<void> {
    const {
      params: { channelId },
      body,
    } = validateRequest(ctx, {
      params: channelIdParamsSchema(),
      body: Joi.object<UpdateChannelUserPreferencesRequest>({
        hideBanner: Joi.boolean(),
      }),
    })

    await this.chatService.updateUserPreferences(channelId, ctx.session!.user.id, body)

    ctx.status = 204
  }

  @httpPost('/:channelId/mark-read')
  @httpBefore(throttleMiddleware(markReadThrottle, throttleByUser))
  async markChannelRead(ctx: RouterContext): Promise<void> {
    const {
      params: { channelId },
      body: { lastReadTime },
    } = validateRequest(ctx, {
      params: channelIdParamsSchema(),
      body: Joi.object<MarkChannelReadRequest>({
        lastReadTime: joiTimestampMillis().integer().min(0).required(),
      }),
    })

    await this.chatService.markRead(channelId, ctx.session!.user.id, new Date(lastReadTime))

    ctx.status = 204
  }

  @httpGet('/:channelId/users/:targetId')
  @httpBefore(throttleMiddleware(getUserProfileThrottle, throttleByUser))
  async getChatUserProfile(ctx: RouterContext): Promise<GetChatUserProfileResponse> {
    const {
      params: { channelId, targetId },
    } = validateRequest(ctx, {
      params: channelUserParamsSchema(),
    })

    return await this.chatService.getChatUserProfile(channelId, ctx.session!.user.id, targetId)
  }

  @httpPost('/:channelId/users/:targetId/remove')
  @httpBefore(throttleMiddleware(kickBanThrottle, throttleByUser))
  async moderateChannelUser(ctx: RouterContext): Promise<void> {
    const {
      params: { channelId, targetId },
      body: { moderationAction, moderationReason },
    } = validateRequest(ctx, {
      params: channelUserParamsSchema(),
      body: moderateChannelUserBodySchema(),
    })

    await this.chatService.moderateUser(
      channelId,
      ctx.session!.user.id,
      targetId,
      moderationAction,
      isServerModerator(ctx),
      moderationReason,
    )

    ctx.status = 204
  }

  @httpGet('/:channelId/users/:targetId/permissions')
  @httpBefore(throttleMiddleware(userPermissionsThrottle, throttleByUser))
  async getChannelUserPermissions(ctx: RouterContext): Promise<GetChannelUserPermissionsResponse> {
    const {
      params: { channelId, targetId },
    } = validateRequest(ctx, {
      params: channelUserParamsSchema(),
    })

    return await this.chatService.getUserPermissions(
      channelId,
      ctx.session!.user.id,
      targetId,
      isServerModerator(ctx),
    )
  }

  @httpGet('/:channelId/user-channel-entries')
  @httpBefore(throttleMiddleware(userChannelEntriesThrottle, throttleByUser))
  async listUserChannelEntries(ctx: RouterContext): Promise<ListUserChannelEntriesResponse> {
    const {
      params: { channelId },
      query: { q: searchQuery, offset },
    } = validateRequest(ctx, {
      params: channelIdParamsSchema(),
      query: searchListQuerySchema(),
    })

    return await this.chatService.listUserChannelEntries({
      channelId,
      userId: ctx.session!.user.id,
      isServerModerator: isServerModerator(ctx),
      limit: CHANNEL_USER_PERMISSIONS_LIMIT,
      offset,
      searchStr: searchQuery,
    })
  }

  @httpGet('/:channelId/bans')
  @httpBefore(throttleMiddleware(channelBansThrottle, throttleByUser))
  async listChannelBans(ctx: RouterContext): Promise<ListChannelBansResponse> {
    const {
      params: { channelId },
      query: { q: searchQuery, offset },
    } = validateRequest(ctx, {
      params: channelIdParamsSchema(),
      query: searchListQuerySchema(),
    })

    return await this.chatService.listChannelBans({
      channelId,
      userId: ctx.session!.user.id,
      isServerModerator: isServerModerator(ctx),
      limit: CHANNEL_BANS_LIMIT,
      offset,
      searchStr: searchQuery,
    })
  }

  @httpDelete('/:channelId/bans/:targetId')
  @httpBefore(throttleMiddleware(kickBanThrottle, throttleByUser))
  async unbanUser(ctx: RouterContext): Promise<void> {
    const {
      params: { channelId, targetId },
    } = validateRequest(ctx, {
      params: channelUserParamsSchema(),
    })

    await this.chatService.unbanUser({
      channelId,
      userId: ctx.session!.user.id,
      targetId,
      isServerModerator: isServerModerator(ctx),
    })

    ctx.status = 204
  }

  @httpPost('/:channelId/users/:targetId/permissions')
  @httpBefore(throttleMiddleware(userPermissionsThrottle, throttleByUser))
  async updateChannelUserPermissions(ctx: RouterContext): Promise<void> {
    const {
      params: { channelId, targetId },
      body: { permissions },
    } = validateRequest(ctx, {
      params: channelUserParamsSchema(),
      body: channelUserPermissionsBodySchema(),
    })

    await this.chatService.updateUserPermissions(
      channelId,
      ctx.session!.user.id,
      targetId,
      permissions,
      isServerModerator(ctx),
    )

    ctx.status = 204
  }

  @httpPost('/:channelId/owner')
  @httpBefore(throttleMiddleware(transferOwnershipThrottle, throttleByUser))
  async transferChannelOwnership(ctx: RouterContext): Promise<void> {
    const channelId = getValidatedChannelId(ctx)
    const {
      body: { targetId },
    } = validateRequest(ctx, {
      body: transferChannelOwnershipBodySchema(),
    })

    await this.chatService.transferOwnership(
      channelId,
      ctx.session!.user.id,
      targetId,
      isServerModerator(ctx),
    )

    ctx.status = 204
  }

  @httpGet('/batch-info')
  @httpBefore(throttleMiddleware(channelRetrievalThrottle, throttleByUser))
  async getBatchedChannelInfos(ctx: RouterContext): Promise<GetBatchedChannelInfosResponse> {
    const {
      query: { c: channelIds },
    } = validateRequest(ctx, {
      query: Joi.object<{ c: SbChannelId[] }>({
        c: Joi.array().items(joiSerialId()).single().min(1).max(40),
      }),
    })

    return await this.chatService.getChannelInfos(channelIds, ctx.session!.user.id)
  }

  // NOTE: @koa/router 15 (path-to-regexp v8) no longer supports inline regex path params, so the
  // previous `:channelId(\\d+)` constraint is enforced by `getValidatedChannelId` instead. This
  // route is registered after the literal `/batch-info` and `/joined-channels` routes, so those
  // still match first.
  @httpGet('/:channelId')
  @httpBefore(throttleMiddleware(channelRetrievalThrottle, throttleByUser))
  async getChannelInfo(ctx: RouterContext): Promise<GetChannelInfoResponse> {
    const channelId = getValidatedChannelId(ctx)

    return await this.chatService.getChannelInfo(
      channelId,
      ctx.session!.user.id,
      isServerModerator(ctx),
    )
  }

  @httpGet('/')
  @httpBefore(throttleMiddleware(channelRetrievalThrottle, throttleByUser))
  async searchChannels(ctx: RouterContext): Promise<SearchChannelsResponse> {
    const {
      query: { q: searchQuery, offset },
    } = validateRequest(ctx, {
      query: Joi.object<{ q?: string; offset: number }>({
        q: Joi.string().allow(''),
        offset: Joi.number().min(0),
      }),
    })

    return await this.chatService.searchChannels({
      userId: ctx.session!.user.id,
      limit: SEARCH_CHANNELS_LIMIT,
      offset,
      searchStr: searchQuery,
    })
  }
}

@httpApi('/admin/chat')
@httpBeforeAll(
  ensureLoggedIn,
  checkAllPermissions('moderateChatChannels'),
  convertChatServiceErrors,
)
export class AdminChatApi {
  constructor(private chatService: ChatService) {}

  @httpGet('/:channelId/messages')
  async getChannelHistory(ctx: RouterContext): Promise<GetChannelHistoryServerResponse> {
    const channelId = getValidatedChannelId(ctx)
    const {
      query: { limit, beforeTime },
    } = validateRequest(ctx, {
      query: Joi.object<{ limit: number; beforeTime: number }>({
        limit: Joi.number().min(1).max(100),
        beforeTime: joiTimestampMillis().min(-1),
      }),
    })

    return await this.chatService.getChannelHistory({
      channelId,
      userId: ctx.session!.user.id,
      limit,
      beforeTime,
      isAdmin: true,
    })
  }

  @httpGet('/:channelId/users')
  async getChannelUsers(ctx: RouterContext): Promise<SbUser[]> {
    const channelId = getValidatedChannelId(ctx)
    return await this.chatService.getChannelUsers({
      channelId,
      userId: ctx.session!.user.id,
      isAdmin: true,
    })
  }

  @httpDelete('/:channelId/messages/:messageId')
  async deleteMessage(ctx: RouterContext): Promise<void> {
    const {
      params: { channelId, messageId },
    } = validateRequest(ctx, {
      params: Joi.object<{ channelId: SbChannelId; messageId: string }>({
        channelId: joiSerialId().required(),
        messageId: Joi.string().required(),
      }),
    })

    await this.chatService.deleteMessage({
      channelId,
      messageId,
      userId: ctx.session!.user.id,
      isAdmin: true,
    })

    ctx.status = 204
  }
}
