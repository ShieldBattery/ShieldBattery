import Router, { RouterContext } from '@koa/router'
import httpErrors from 'http-errors'
import Joi from 'joi'
import Koa from 'koa'
import { container } from 'tsyringe'
import { assertUnreachable } from '../../../common/assert-unreachable'
import { CHANNEL_MAXLENGTH, CHANNEL_PATTERN } from '../../../common/constants'
import { MULTI_CHANNEL } from '../../../common/flags'
import { featureEnabled } from '../flags/feature-enabled'
import { httpApi, HttpApi } from '../http/http-api'
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

function isChatServiceError(error: Error): error is ChatServiceError {
  return error.hasOwnProperty('code')
}

function convertChatServiceError(err: Error) {
  if (!isChatServiceError(err)) {
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
      throw new httpErrors.BadRequest(err.message)
    case ChatServiceErrorCode.LeaveShieldBattery:
      throw new httpErrors.Forbidden(err.message)
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

@httpApi()
export class ChatApi extends HttpApi {
  constructor() {
    super('/chat')
    container.resolve(ChatService)
  }

  applyRoutes(router: Router): void {
    router
      .use(ensureLoggedIn, convertChatServiceErrors)
      .post(
        '/:channelName',
        featureEnabled(MULTI_CHANNEL),
        throttleMiddleware(joinThrottle, ctx => String(ctx.session!.userId)),
        joinChannel,
      )
      .delete(
        '/:channelName',
        featureEnabled(MULTI_CHANNEL),
        throttleMiddleware(leaveThrottle, ctx => String(ctx.session!.userId)),
        leaveChannel,
      )
      .post(
        '/:channelName/messages',
        throttleMiddleware(sendThrottle, ctx => String(ctx.session!.userId)),
        sendChatMessage,
      )
      .get(
        '/:channelName/messages',
        throttleMiddleware(retrievalThrottle, ctx => String(ctx.session!.userId)),
        getChannelHistory,
      )
      .get(
        '/:channelName/users',
        throttleMiddleware(retrievalThrottle, ctx => String(ctx.session!.userId)),
        getChannelUsers,
      )
  }
}

function joinChannel(ctx: RouterContext) {
  const channelName = getValidatedChannelName(ctx)

  const chatService = container.resolve(ChatService)
  chatService.joinChannel(channelName, ctx.session!.userId)

  ctx.status = 204
}

function leaveChannel(ctx: RouterContext) {
  const channelName = getValidatedChannelName(ctx)

  const chatService = container.resolve(ChatService)
  chatService.leaveChannel(channelName, ctx.session!.userId)

  ctx.status = 204
}

function sendChatMessage(ctx: RouterContext) {
  const channelName = getValidatedChannelName(ctx)
  const {
    body: { message },
  } = validateRequest(ctx, {
    body: Joi.object<{ message: string }>({
      message: Joi.string().min(1).required(),
    }),
  })

  const chatService = container.resolve(ChatService)
  chatService.sendChatMessage(channelName, ctx.session!.userId, message)

  ctx.status = 204
}

async function getChannelHistory(ctx: RouterContext) {
  const channelName = getValidatedChannelName(ctx)
  const {
    query: { limit, beforeTime },
  } = validateRequest(ctx, {
    query: Joi.object<{ limit: number; beforeTime: number }>({
      limit: Joi.number().min(1).max(100),
      beforeTime: Joi.number().min(-1),
    }),
  })

  const chatService = container.resolve(ChatService)
  ctx.body = await chatService.getChannelHistory(
    channelName,
    ctx.session!.userId,
    limit,
    beforeTime,
  )
}

async function getChannelUsers(ctx: RouterContext) {
  const channelName = getValidatedChannelName(ctx)

  const chatService = container.resolve(ChatService)
  ctx.body = await chatService.getChannelUsers(channelName, ctx.session!.userId)
}
