import { RouterContext } from '@koa/router'
import httpErrors from 'http-errors'
import Joi from 'joi'
import Koa from 'koa'
import { assertUnreachable } from '../../../common/assert-unreachable'
import {
  ChannelPermissions,
  ChatServiceErrorCode,
  GetBatchedChannelInfosResponse,
  GetChannelHistoryServerResponse,
  GetChannelInfoResponse,
  GetChannelUserPermissionsResponse,
  GetChatUserProfileResponse,
  JoinChannelResponse,
  ModerateChannelUserServerRequest,
  SEARCH_CHANNELS_LIMIT,
  SbChannelId,
  SearchChannelsResponse,
  SendChatMessageServerRequest,
  UpdateChannelUserPermissionsRequest,
} from '../../../common/chat'
import {
  AdminEditChannelBannerRequest,
  AdminEditChannelBannerResponse,
  AdminGetChannelBannerResponse,
  AdminGetChannelBannersResponse,
  AdminUploadChannelBannerRequest,
  AdminUploadChannelBannerResponse,
  CHANNEL_BANNER_HEIGHT,
  CHANNEL_BANNER_WIDTH,
  ChannelBanner,
  ChannelBannerId,
  toChannelBannerJson,
} from '../../../common/chat-channels/channel-banners'
import { CHANNEL_MAXLENGTH, CHANNEL_PATTERN } from '../../../common/constants'
import { MULTI_CHANNEL } from '../../../common/flags'
import { MAX_IMAGE_SIZE, createImagePath, resizeImage } from '../../../common/images'
import { SbUser, SbUserId } from '../../../common/users/sb-user'
import transact from '../db/transaction'
import { asHttpError } from '../errors/error-with-payload'
import { writeFile } from '../file-upload'
import { handleMultipartFiles } from '../file-upload/handle-multipart-files'
import { featureEnabled } from '../flags/feature-enabled'
import { httpApi, httpBeforeAll } from '../http/http-api'
import { httpBefore, httpDelete, httpGet, httpPatch, httpPost } from '../http/route-decorators'
import { Patch } from '../leagues/league-models'
import { checkAllPermissions } from '../permissions/check-permissions'
import ensureLoggedIn from '../session/ensure-logged-in'
import createThrottle from '../throttle/create-throttle'
import throttleMiddleware from '../throttle/middleware'
import { validateRequest } from '../validation/joi-validator'
import {
  adminAddChannelBanner,
  adminGetChannelBanner,
  adminGetChannelBanners,
  adminUpdateChannelBanner,
} from './channel-banner-models'
import { findChannelsByName, getChannelInfos, toBasicChannelInfo } from './chat-models'
import ChatService, { ChatServiceError } from './chat-service'

const joinThrottle = createThrottle('chatjoin', {
  rate: 3,
  burst: 10,
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
  rate: 50,
  burst: 90,
  window: 60000,
})

const getUserProfileThrottle = createThrottle('chatgetuserprofile', {
  rate: 40,
  burst: 80,
  window: 60000,
})

const userPermissionsThrottle = createThrottle('chatuserpermissions', {
  rate: 30,
  burst: 60,
  window: 60000,
})

const joiSerialId = () => Joi.number().min(1)
const channelNameSchema = () => Joi.string().max(CHANNEL_MAXLENGTH).pattern(CHANNEL_PATTERN)

function convertChatServiceError(err: unknown) {
  if (!(err instanceof ChatServiceError)) {
    throw err
  }

  switch (err.code) {
    case ChatServiceErrorCode.ChannelBannerNotFound:
    case ChatServiceErrorCode.ChannelNotFound:
    case ChatServiceErrorCode.NotInChannel:
    case ChatServiceErrorCode.TargetNotInChannel:
    case ChatServiceErrorCode.UserOffline:
    case ChatServiceErrorCode.UserNotFound:
      throw asHttpError(404, err)
    case ChatServiceErrorCode.CannotModerateYourself:
    case ChatServiceErrorCode.CannotLeaveShieldBattery:
    case ChatServiceErrorCode.CannotModerateShieldBattery:
    case ChatServiceErrorCode.NoInitialChannelData:
      throw asHttpError(400, err)
    case ChatServiceErrorCode.CannotChangeChannelOwner:
    case ChatServiceErrorCode.CannotModerateChannelOwner:
    case ChatServiceErrorCode.CannotModerateChannelModerator:
    case ChatServiceErrorCode.MaximumJoinedChannels:
    case ChatServiceErrorCode.MaximumOwnedChannels:
    case ChatServiceErrorCode.NotEnoughPermissions:
      throw asHttpError(403, err)
    case ChatServiceErrorCode.UserBanned:
      throw asHttpError(401, err)
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
    params: Joi.object<{ channelId: SbChannelId }>({
      channelId: joiSerialId().required(),
    }),
  })

  return channelId
}

@httpApi('/chat')
@httpBeforeAll(ensureLoggedIn, convertChatServiceErrors)
export class ChatApi {
  constructor(private chatService: ChatService) {}

  @httpPost('/join/:channelName')
  @httpBefore(
    featureEnabled(MULTI_CHANNEL),
    throttleMiddleware(joinThrottle, ctx => String(ctx.session!.userId)),
  )
  async joinChannel(ctx: RouterContext): Promise<JoinChannelResponse> {
    const {
      params: { channelName },
    } = validateRequest(ctx, {
      params: Joi.object<{ channelName: string }>({
        channelName: channelNameSchema().required(),
      }),
    })

    return await this.chatService.joinChannel(channelName, ctx.session!.userId)
  }

  @httpDelete('/:channelId')
  @httpBefore(
    featureEnabled(MULTI_CHANNEL),
    throttleMiddleware(leaveThrottle, ctx => String(ctx.session!.userId)),
  )
  async leaveChannel(ctx: RouterContext): Promise<void> {
    const channelId = getValidatedChannelId(ctx)

    await this.chatService.leaveChannel(channelId, ctx.session!.userId)

    ctx.status = 204
  }

  @httpPost('/:channelId/messages')
  @httpBefore(throttleMiddleware(sendThrottle, ctx => String(ctx.session!.userId)))
  async sendChatMessage(ctx: RouterContext): Promise<void> {
    const channelId = getValidatedChannelId(ctx)
    const {
      body: { message },
    } = validateRequest(ctx, {
      body: Joi.object<SendChatMessageServerRequest>({
        message: Joi.string().min(1).required(),
      }),
    })

    await this.chatService.sendChatMessage(channelId, ctx.session!.userId, message)

    ctx.status = 204
  }

  /**
   * @deprecated This API was last used in version 7.1.4. Use `/:channelId/messages2` instead.
   */
  @httpGet('/:channelName/messages')
  @httpBefore(throttleMiddleware(retrievalThrottle, ctx => String(ctx.session!.userId)))
  getChannelHistoryOld(ctx: RouterContext) {
    return []
  }

  @httpGet('/:channelId/messages2')
  @httpBefore(throttleMiddleware(retrievalThrottle, ctx => String(ctx.session!.userId)))
  async getChannelHistory(ctx: RouterContext): Promise<GetChannelHistoryServerResponse> {
    const channelId = getValidatedChannelId(ctx)
    const {
      query: { limit, beforeTime },
    } = validateRequest(ctx, {
      query: Joi.object<{ limit: number; beforeTime: number }>({
        limit: Joi.number().min(1).max(100),
        beforeTime: Joi.number().min(-1),
      }),
    })

    return await this.chatService.getChannelHistory({
      channelId,
      userId: ctx.session!.userId,
      limit,
      beforeTime,
    })
  }

  /**
   * @deprecated This API was last used in version 7.1.7. Use `/:channelId/users2` instead.
   */
  @httpGet('/:channelName/users')
  @httpBefore(throttleMiddleware(retrievalThrottle, ctx => String(ctx.session!.userId)))
  async getChannelUsersOld(ctx: RouterContext) {
    return []
  }

  @httpGet('/:channelId/users2')
  @httpBefore(throttleMiddleware(retrievalThrottle, ctx => String(ctx.session!.userId)))
  async getChannelUsers(ctx: RouterContext): Promise<SbUser[]> {
    const channelId = getValidatedChannelId(ctx)
    return await this.chatService.getChannelUsers({ channelId, userId: ctx.session!.userId })
  }

  @httpGet('/:channelId/users/:targetId')
  @httpBefore(throttleMiddleware(getUserProfileThrottle, ctx => String(ctx.session!.userId)))
  async getChatUserProfile(ctx: RouterContext): Promise<GetChatUserProfileResponse> {
    const {
      params: { channelId, targetId },
    } = validateRequest(ctx, {
      params: Joi.object<{ channelId: SbChannelId; targetId: SbUserId }>({
        channelId: joiSerialId().required(),
        targetId: joiSerialId().required(),
      }),
    })

    return await this.chatService.getChatUserProfile(channelId, ctx.session!.userId, targetId)
  }

  @httpPost('/:channelId/users/:targetId/remove')
  @httpBefore(
    featureEnabled(MULTI_CHANNEL),
    throttleMiddleware(kickBanThrottle, ctx => String(ctx.session!.userId)),
  )
  async moderateChannelUser(ctx: RouterContext): Promise<void> {
    const {
      params: { channelId, targetId },
      body: { moderationAction, moderationReason },
    } = validateRequest(ctx, {
      params: Joi.object<{ channelId: SbChannelId; targetId: SbUserId }>({
        channelId: joiSerialId().required(),
        targetId: joiSerialId().required(),
      }),
      body: Joi.object<ModerateChannelUserServerRequest>({
        moderationAction: Joi.string().valid('kick', 'ban').required(),
        moderationReason: Joi.string().allow(''),
      }),
    })

    await this.chatService.moderateUser(
      channelId,
      ctx.session!.userId,
      targetId,
      moderationAction,
      moderationReason,
    )

    ctx.status = 204
  }

  @httpGet('/:channelId/users/:targetId/permissions')
  @httpBefore(
    featureEnabled(MULTI_CHANNEL),
    throttleMiddleware(userPermissionsThrottle, ctx => String(ctx.session!.userId)),
  )
  async getChannelUserPermissions(ctx: RouterContext): Promise<GetChannelUserPermissionsResponse> {
    const {
      params: { channelId, targetId },
    } = validateRequest(ctx, {
      params: Joi.object<{ channelId: SbChannelId; targetId: SbUserId }>({
        channelId: joiSerialId().required(),
        targetId: joiSerialId().required(),
      }),
    })

    return await this.chatService.getUserPermissions(channelId, ctx.session!.userId, targetId)
  }

  @httpPost('/:channelId/users/:targetId/permissions')
  @httpBefore(
    featureEnabled(MULTI_CHANNEL),
    throttleMiddleware(userPermissionsThrottle, ctx => String(ctx.session!.userId)),
  )
  async updateChannelUserPermissions(ctx: RouterContext): Promise<void> {
    const {
      params: { channelId, targetId },
      body: { permissions },
    } = validateRequest(ctx, {
      params: Joi.object<{ channelId: SbChannelId; targetId: SbUserId }>({
        channelId: joiSerialId().required(),
        targetId: joiSerialId().required(),
      }),
      body: Joi.object<UpdateChannelUserPermissionsRequest>({
        permissions: Joi.object<ChannelPermissions>({
          kick: Joi.boolean().required(),
          ban: Joi.boolean().required(),
          changeTopic: Joi.boolean().required(),
          togglePrivate: Joi.boolean().required(),
          editPermissions: Joi.boolean().required(),
        }).required(),
      }),
    })

    await this.chatService.updateUserPermissions(
      channelId,
      ctx.session!.userId,
      targetId,
      permissions,
    )

    ctx.status = 204
  }

  @httpGet('/batch-info')
  @httpBefore(throttleMiddleware(channelRetrievalThrottle, ctx => String(ctx.session!.userId)))
  async getBatchedChannelInfos(ctx: RouterContext): Promise<GetBatchedChannelInfosResponse> {
    const {
      query: { c: channelIds },
    } = validateRequest(ctx, {
      query: Joi.object<{ c: SbChannelId[] }>({
        c: Joi.array().items(joiSerialId()).single().min(1).max(40),
      }),
    })

    return await this.chatService.getChannelInfos(channelIds, ctx.session!.userId)
  }

  @httpGet('/:channelId(\\d+)')
  @httpBefore(throttleMiddleware(channelRetrievalThrottle, ctx => String(ctx.session!.userId)))
  async getChannelInfo(ctx: RouterContext): Promise<GetChannelInfoResponse> {
    const channelId = getValidatedChannelId(ctx)

    return await this.chatService.getChannelInfo(channelId, ctx.session!.userId)
  }

  @httpGet('/')
  @httpBefore(
    featureEnabled(MULTI_CHANNEL),
    throttleMiddleware(channelRetrievalThrottle, ctx => String(ctx.session!.userId)),
  )
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
      userId: ctx.session!.userId,
      limit: SEARCH_CHANNELS_LIMIT,
      offset,
      searchStr: searchQuery,
    })
  }
}

@httpApi('/admin/chat')
@httpBeforeAll(ensureLoggedIn, convertChatServiceErrors)
export class AdminChatApi {
  constructor(private chatService: ChatService) {}

  @httpGet('/:channelId/messages')
  @httpBefore(checkAllPermissions('moderateChatChannels'))
  async getChannelHistory(ctx: RouterContext): Promise<GetChannelHistoryServerResponse> {
    const channelId = getValidatedChannelId(ctx)
    const {
      query: { limit, beforeTime },
    } = validateRequest(ctx, {
      query: Joi.object<{ limit: number; beforeTime: number }>({
        limit: Joi.number().min(1).max(100),
        beforeTime: Joi.number().min(-1),
      }),
    })

    return await this.chatService.getChannelHistory({
      channelId,
      userId: ctx.session!.userId,
      limit,
      beforeTime,
      isAdmin: true,
    })
  }

  @httpGet('/:channelId/users')
  @httpBefore(checkAllPermissions('moderateChatChannels'))
  async getChannelUsers(ctx: RouterContext): Promise<SbUser[]> {
    const channelId = getValidatedChannelId(ctx)
    return await this.chatService.getChannelUsers({
      channelId,
      userId: ctx.session!.userId,
      isAdmin: true,
    })
  }

  @httpDelete('/:channelId/messages/:messageId')
  @httpBefore(checkAllPermissions('moderateChatChannels'))
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
      userId: ctx.session!.userId,
      isAdmin: true,
    })

    ctx.status = 204
  }

  @httpGet('/banners/:bannerId')
  @httpBefore(checkAllPermissions('manageChannelContent'))
  async getChannelBanner(ctx: RouterContext): Promise<AdminGetChannelBannerResponse> {
    const {
      params: { bannerId },
    } = validateRequest(ctx, {
      params: Joi.object<{ bannerId: ChannelBannerId }>({
        bannerId: Joi.string().uuid().required(),
      }),
    })

    const channelBanner = await adminGetChannelBanner(bannerId)

    if (!channelBanner) {
      throw new ChatServiceError(
        ChatServiceErrorCode.ChannelBannerNotFound,
        'channel banner not found',
      )
    }

    const channelIds = new Set<SbChannelId>()
    for (let j = 0; j < channelBanner.availableIn.length; j++) {
      channelIds.add(channelBanner.availableIn[j])
    }
    const channelInfos = await getChannelInfos(Array.from(channelIds))

    return {
      channelBanner: toChannelBannerJson(channelBanner),
      channelInfos: channelInfos.map(c => toBasicChannelInfo(c)),
    }
  }

  @httpGet('/banners')
  @httpBefore(checkAllPermissions('manageChannelContent'))
  async getChannelBanners(ctx: RouterContext): Promise<AdminGetChannelBannersResponse> {
    const channelBanners = await adminGetChannelBanners()
    const channelIds = new Set<SbChannelId>()
    for (let i = 0; i < channelBanners.length; i++) {
      for (let j = 0; j < channelBanners[i].availableIn.length; j++) {
        channelIds.add(channelBanners[i].availableIn[j])
      }
    }
    const channelInfos = await getChannelInfos(Array.from(channelIds))

    return {
      channelBanners: channelBanners.map(b => toChannelBannerJson(b)),
      channelInfos: channelInfos.map(c => toBasicChannelInfo(c)),
    }
  }

  @httpPost('/banners')
  @httpBefore(checkAllPermissions('manageChannelContent'), handleMultipartFiles(MAX_IMAGE_SIZE))
  async addChannelBanner(ctx: RouterContext): Promise<AdminUploadChannelBannerResponse> {
    const {
      body: { name, availableIn },
    } = validateRequest(ctx, {
      body: Joi.object<AdminUploadChannelBannerRequest & { image: any }>({
        name: Joi.string().required(),
        availableIn: Joi.array().items(Joi.string()),
        image: Joi.any(),
      }),
    })

    const imageFile = ctx.request.files?.image
    if (!imageFile) {
      throw new httpErrors.BadRequest('image file is required')
    }
    if (Array.isArray(imageFile)) {
      throw new httpErrors.BadRequest('only one channel banner file can be uploaded')
    }
    const [image, imageExtension] = await resizeImage(
      imageFile.filepath,
      CHANNEL_BANNER_WIDTH,
      CHANNEL_BANNER_HEIGHT,
    )

    return await transact(async client => {
      const channelInfos =
        availableIn && availableIn.length > 0 ? await findChannelsByName(availableIn) : []
      const imagePath = createImagePath('channel-banner-images', imageExtension)

      const channelBanner = await adminAddChannelBanner(
        {
          name,
          limited: channelInfos.length > 0,
          availableIn: channelInfos.map(c => c.id),
          imagePath,
        },
        client,
      )

      const buffer = await image.toBuffer()
      await writeFile(imagePath, buffer, {
        acl: 'public-read',
        type: imageExtension === 'png' ? 'image/png' : 'image/jpeg',
      })

      return {
        channelBanner: toChannelBannerJson(channelBanner),
      }
    })
  }

  @httpPatch('/banners/:bannerId')
  @httpBefore(checkAllPermissions('manageChannelContent'), handleMultipartFiles(MAX_IMAGE_SIZE))
  async editChannelBanner(ctx: RouterContext): Promise<AdminEditChannelBannerResponse> {
    const {
      params: { bannerId },
    } = validateRequest(ctx, {
      params: Joi.object<{ bannerId: ChannelBannerId }>({
        bannerId: Joi.string().uuid().required(),
      }),
    })
    const originalChannelBanner = await adminGetChannelBanner(bannerId)

    if (!originalChannelBanner) {
      throw new ChatServiceError(
        ChatServiceErrorCode.ChannelBannerNotFound,
        'channel banner not found',
      )
    }

    const {
      body: { name, availableIn, deleteLimited },
    } = validateRequest(ctx, {
      body: Joi.object<AdminEditChannelBannerRequest & { image: any }>({
        name: Joi.string(),
        availableIn: Joi.array().items(Joi.string()),
        deleteLimited: Joi.boolean(),
        image: Joi.any(),
      }),
    })

    const imageFile = ctx.request.files?.image
    if (Array.isArray(imageFile)) {
      throw new httpErrors.BadRequest('only one channel banner file can be uploaded')
    }
    const [image, imageExtension] = imageFile
      ? await resizeImage(imageFile.filepath, CHANNEL_BANNER_WIDTH, CHANNEL_BANNER_HEIGHT)
      : [undefined, undefined]

    return await transact(async client => {
      const updatedChannelBanner: Patch<Omit<ChannelBanner, 'id' | 'uploadedAt' | 'updatedAt'>> = {}

      if (name) {
        updatedChannelBanner.name = name
      }
      if (availableIn) {
        const channelInfos = availableIn.length > 0 ? await findChannelsByName(availableIn) : []
        updatedChannelBanner.limited = channelInfos.length > 0
        updatedChannelBanner.availableIn = channelInfos.map(c => c.id)
      }
      if (deleteLimited) {
        updatedChannelBanner.limited = false
        updatedChannelBanner.availableIn = []
      }
      let imagePath: string | undefined
      if (image) {
        imagePath = createImagePath('channel-banner-images', imageExtension)
        updatedChannelBanner.imagePath = imagePath
      }

      const channelBanner = await adminUpdateChannelBanner(bannerId, updatedChannelBanner, client)

      if (image && imagePath) {
        const buffer = await image.toBuffer()
        await writeFile(imagePath, buffer, {
          acl: 'public-read',
          type: imageExtension === 'png' ? 'image/png' : 'image/jpeg',
        })
      }

      return {
        channelBanner: toChannelBannerJson(channelBanner),
      }
    })
  }
}
