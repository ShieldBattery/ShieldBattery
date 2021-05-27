import Router, { RouterContext } from '@koa/router'
import httpErrors from 'http-errors'
import Joi from 'joi'
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
    case ChatServiceErrorCode.InvalidAction:
      throw new httpErrors.BadRequest(err.message)
    default:
      assertUnreachable(err.code)
  }
}

@httpApi()
export class ChatApi extends HttpApi {
  constructor() {
    super('/chat')
    container.resolve(ChatService)
  }

  applyRoutes(router: Router): void {
    router
      .use(featureEnabled(MULTI_CHANNEL), ensureLoggedIn)
      .post(
        '/:channelName',
        throttleMiddleware(joinThrottle, ctx => String(ctx.session!.userId)),
        joinChannel,
      )
      .delete(
        '/:channelName',
        throttleMiddleware(leaveThrottle, ctx => String(ctx.session!.userId)),
        leaveChannel,
      )
      .patch(
        '/:channelName',
        throttleMiddleware(sendThrottle, ctx => String(ctx.session!.userId)),
        sendChatMessage,
      )
      .get(
        '/:channelName/chat',
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
  const {
    params: { channelName },
  } = validateRequest(ctx, {
    params: Joi.object<{ channelName: string }>({
      channelName: Joi.string().max(CHANNEL_MAXLENGTH).pattern(CHANNEL_PATTERN).required(),
    }),
  })

  try {
    const chatService = container.resolve(ChatService)
    chatService.joinChannel(channelName, ctx.session!.userId)

    ctx.status = 204
  } catch (err) {
    convertChatServiceError(err)
  }
}
