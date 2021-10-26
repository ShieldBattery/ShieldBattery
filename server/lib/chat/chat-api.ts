import { RouterContext } from '@koa/router'
import httpErrors from 'http-errors'
import Joi from 'joi'
import Koa from 'koa'
import { assertUnreachable } from '../../../common/assert-unreachable'
import {
  GetChannelHistoryServerPayload,
  GetChannelUsersServerPayload,
  ModerateChannelUserServerBody,
  SendChatMessageServerBody,
} from '../../../common/chat'
import { CHANNEL_MAXLENGTH, CHANNEL_PATTERN } from '../../../common/constants'
import { MULTI_CHANNEL } from '../../../common/flags'
import { featureEnabled } from '../flags/feature-enabled'
import { httpApi, httpBeforeAll } from '../http/http-api'
import { httpBefore, httpDelete, httpGet, httpPost } from '../http/route-decorators'
import ensureLoggedIn from '../session/ensure-logged-in'
import createThrottle from '../throttle/create-throttle'
import throttleMiddleware from '../throttle/middleware'
import { validateRequest } from '../validation/joi-validator'
import ChatService, { ChatServiceError, ChatServiceErrorCode } from './chat-service'

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

function convertChatServiceError(err: unknown) {
  if (!(err instanceof ChatServiceError)) {
    throw err
  }

  switch (err.code) {
    case ChatServiceErrorCode.UserOffline:
      throw new httpErrors.NotFound(err.message)
    case ChatServiceErrorCode.InvalidJoinAction:
    case ChatServiceErrorCode.InvalidLeaveAction:
    case ChatServiceErrorCode.InvalidSendAction:
    case ChatServiceErrorCode.InvalidGetHistoryAction:
    case ChatServiceErrorCode.InvalidGetUsersAction:
    case ChatServiceErrorCode.InvalidModerationAction:
      throw new httpErrors.BadRequest(err.message)
    case ChatServiceErrorCode.LeaveShieldBattery:
    case ChatServiceErrorCode.ModeratorAccess:
      throw new httpErrors.Forbidden(err.message)
    case ChatServiceErrorCode.UserBanned:
      throw new httpErrors.Unauthorized(err.message)
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
      body: Joi.object<SendChatMessageServerBody>({
        message: Joi.string().min(1).required(),
      }),
    })

    await this.chatService.sendChatMessage(channelName, ctx.session!.userId, message)

    ctx.status = 204
  }

  @httpGet('/:channelName/messages')
  @httpBefore(throttleMiddleware(retrievalThrottle, ctx => String(ctx.session!.userId)))
  async getChannelHistory(ctx: RouterContext): Promise<GetChannelHistoryServerPayload> {
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

  @httpGet('/:channelName/users')
  @httpBefore(throttleMiddleware(retrievalThrottle, ctx => String(ctx.session!.userId)))
  async getChannelUsers(ctx: RouterContext): Promise<GetChannelUsersServerPayload> {
    const channelName = getValidatedChannelName(ctx)
    return await this.chatService.getChannelUsers(channelName, ctx.session!.userId)
  }

  @httpDelete('/:channelName/:targetId')
  @httpBefore(
    featureEnabled(MULTI_CHANNEL),
    throttleMiddleware(kickBanThrottle, ctx => String(ctx.session!.userId)),
  )
  async moderateChannelUser(ctx: RouterContext): Promise<void> {
    const channelName = getValidatedChannelName(ctx)
    const {
      params: { targetId, moderationAction, moderationReason },
    } = validateRequest(ctx, {
      params: Joi.object<ModerateChannelUserServerBody>({
        targetId: Joi.number().min(1).required(),
        moderationAction: Joi.string().valid('kick', 'ban').required(),
        moderationReason: Joi.string(),
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
