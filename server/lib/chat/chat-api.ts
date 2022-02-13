import { RouterContext } from '@koa/router'
import Joi from 'joi'
import Koa from 'koa'
import { assertUnreachable } from '../../../common/assert-unreachable'
import {
  ChatServiceErrorCode,
  GetChannelHistoryServerResponse,
  GetChatUserProfileResponse,
  ModerateChannelUserServerRequest,
  SendChatMessageServerRequest,
} from '../../../common/chat'
import { CHANNEL_MAXLENGTH, CHANNEL_PATTERN } from '../../../common/constants'
import { MULTI_CHANNEL } from '../../../common/flags'
import { SbUser, SbUserId } from '../../../common/users/sb-user'
import { asHttpError } from '../errors/error-with-payload'
import { featureEnabled } from '../flags/feature-enabled'
import { httpApi, httpBeforeAll } from '../http/http-api'
import { httpBefore, httpDelete, httpGet, httpPost } from '../http/route-decorators'
import ensureLoggedIn from '../session/ensure-logged-in'
import createThrottle from '../throttle/create-throttle'
import throttleMiddleware from '../throttle/middleware'
import { validateRequest } from '../validation/joi-validator'
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

function convertChatServiceError(err: unknown) {
  if (!(err instanceof ChatServiceError)) {
    throw err
  }

  switch (err.code) {
    case ChatServiceErrorCode.NotInChannel:
    case ChatServiceErrorCode.TargetNotInChannel:
    case ChatServiceErrorCode.UserOffline:
    case ChatServiceErrorCode.UserNotFound:
      throw asHttpError(404, err)
    case ChatServiceErrorCode.AlreadyJoined:
    case ChatServiceErrorCode.CannotModerateYourself:
    case ChatServiceErrorCode.CannotLeaveShieldBattery:
    case ChatServiceErrorCode.CannotModerateShieldBattery:
      throw asHttpError(400, err)
    case ChatServiceErrorCode.CannotModerateChannelOwner:
    case ChatServiceErrorCode.CannotModerateChannelModerator:
    case ChatServiceErrorCode.NotEnoughPermissionsToModerate:
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

function getValidatedChannelName(ctx: RouterContext) {
  const {
    params: { channelName },
  } = validateRequest(ctx, {
    params: Joi.object<{ channelName: string }>({
      channelName: Joi.string().max(CHANNEL_MAXLENGTH).pattern(CHANNEL_PATTERN).required(),
    }),
  })

  return channelName
}

@httpApi('/chat')
@httpBeforeAll(ensureLoggedIn, convertChatServiceErrors)
export class ChatApi {
  constructor(private chatService: ChatService) {}

  @httpPost('/:channelName')
  @httpBefore(
    featureEnabled(MULTI_CHANNEL),
    throttleMiddleware(joinThrottle, ctx => String(ctx.session!.userId)),
  )
  async joinChannel(ctx: RouterContext): Promise<void> {
    const channelName = getValidatedChannelName(ctx)

    await this.chatService.joinChannel(channelName, ctx.session!.userId)

    ctx.status = 204
  }

  @httpDelete('/:channelName')
  @httpBefore(
    featureEnabled(MULTI_CHANNEL),
    throttleMiddleware(leaveThrottle, ctx => String(ctx.session!.userId)),
  )
  async leaveChannel(ctx: RouterContext): Promise<void> {
    const channelName = getValidatedChannelName(ctx)

    await this.chatService.leaveChannel(channelName, ctx.session!.userId)

    ctx.status = 204
  }

  @httpPost('/:channelName/messages')
  @httpBefore(throttleMiddleware(sendThrottle, ctx => String(ctx.session!.userId)))
  async sendChatMessage(ctx: RouterContext): Promise<void> {
    const channelName = getValidatedChannelName(ctx)
    const {
      body: { message },
    } = validateRequest(ctx, {
      body: Joi.object<SendChatMessageServerRequest>({
        message: Joi.string().min(1).required(),
      }),
    })

    await this.chatService.sendChatMessage(channelName, ctx.session!.userId, message)

    ctx.status = 204
  }

  /**
   * @deprecated This API was last used in version 7.1.4. Use `/:channelName/messages2` instead.
   */
  @httpGet('/:channelName/messages')
  @httpBefore(throttleMiddleware(retrievalThrottle, ctx => String(ctx.session!.userId)))
  getChannelHistoryOld(ctx: RouterContext) {
    return []
  }

  @httpGet('/:channelName/messages2')
  @httpBefore(throttleMiddleware(retrievalThrottle, ctx => String(ctx.session!.userId)))
  async getChannelHistory(ctx: RouterContext): Promise<GetChannelHistoryServerResponse> {
    const channelName = getValidatedChannelName(ctx)
    const {
      query: { limit, beforeTime },
    } = validateRequest(ctx, {
      query: Joi.object<{ limit: number; beforeTime: number }>({
        limit: Joi.number().min(1).max(100),
        beforeTime: Joi.number().min(-1),
      }),
    })

    return await this.chatService.getChannelHistory(
      channelName,
      ctx.session!.userId,
      limit,
      beforeTime,
    )
  }

  /**
   * @deprecated This API was last used in version 7.1.7. Use `/:channelName/users2` instead.
   */
  @httpGet('/:channelName/users')
  @httpBefore(throttleMiddleware(retrievalThrottle, ctx => String(ctx.session!.userId)))
  async getChannelUsersOld(ctx: RouterContext) {
    return []
  }

  @httpGet('/:channelName/users2')
  @httpBefore(throttleMiddleware(retrievalThrottle, ctx => String(ctx.session!.userId)))
  async getChannelUsers(ctx: RouterContext): Promise<SbUser[]> {
    const channelName = getValidatedChannelName(ctx)
    return await this.chatService.getChannelUsers(channelName, ctx.session!.userId)
  }

  @httpGet('/:channelName/users/:targetId')
  @httpBefore(throttleMiddleware(getUserProfileThrottle, ctx => String(ctx.session!.userId)))
  async getChatUserProfile(ctx: RouterContext): Promise<GetChatUserProfileResponse> {
    const {
      params: { channelName, targetId },
    } = validateRequest(ctx, {
      params: Joi.object<{ channelName: string; targetId: SbUserId }>({
        channelName: Joi.string().max(CHANNEL_MAXLENGTH).pattern(CHANNEL_PATTERN).required(),
        targetId: Joi.number().min(1).required(),
      }),
    })

    return await this.chatService.getChatUserProfile(channelName, ctx.session!.userId, targetId)
  }

  @httpPost('/:channelName/users/:targetId/remove')
  @httpBefore(
    featureEnabled(MULTI_CHANNEL),
    throttleMiddleware(kickBanThrottle, ctx => String(ctx.session!.userId)),
  )
  async moderateChannelUser(ctx: RouterContext): Promise<void> {
    const {
      params: { channelName, targetId },
      body: { moderationAction, moderationReason },
    } = validateRequest(ctx, {
      params: Joi.object<{ channelName: string; targetId: SbUserId }>({
        channelName: Joi.string().max(CHANNEL_MAXLENGTH).pattern(CHANNEL_PATTERN).required(),
        targetId: Joi.number().min(1).required(),
      }),
      body: Joi.object<ModerateChannelUserServerRequest>({
        moderationAction: Joi.string().valid('kick', 'ban').required(),
        moderationReason: Joi.string().allow(''),
      }),
    })

    await this.chatService.moderateUser(
      channelName,
      ctx.session!.userId,
      targetId,
      moderationAction,
      moderationReason,
    )

    ctx.status = 204
  }
}
