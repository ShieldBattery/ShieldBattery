import Router, { RouterContext } from '@koa/router'
import httpErrors from 'http-errors'
import Joi from 'joi'
import Koa from 'koa'
import { container } from 'tsyringe'
import { assertUnreachable } from '../../../common/assert-unreachable'
import { USERNAME_MAXLENGTH, USERNAME_MINLENGTH, USERNAME_PATTERN } from '../../../common/constants'
import { httpApi, HttpApi } from '../http/http-api'
import ensureLoggedIn from '../session/ensure-logged-in'
import createThrottle from '../throttle/create-throttle'
import throttleMiddleware from '../throttle/middleware'
import { validateRequest } from '../validation/joi-validator'
import WhisperService, { WhisperServiceError, WhisperServiceErrorCode } from './whisper-service'

const startThrottle = createThrottle('whisperstart', {
  rate: 3,
  burst: 10,
  window: 60000,
})

const closeThrottle = createThrottle('whisperclose', {
  rate: 10,
  burst: 20,
  window: 60000,
})

const sendThrottle = createThrottle('whispersend', {
  rate: 30,
  burst: 90,
  window: 60000,
})

const retrievalThrottle = createThrottle('whisperretrieval', {
  rate: 30,
  burst: 120,
  window: 60000,
})

function isWhisperServiceError(error: Error): error is WhisperServiceError {
  return error.hasOwnProperty('code')
}

function convertWhisperServiceError(err: Error) {
  if (!isWhisperServiceError(err)) {
    throw err
  }

  switch (err.code) {
    case WhisperServiceErrorCode.UserOffline:
    case WhisperServiceErrorCode.UserNotFound:
      throw new httpErrors.NotFound(err.message)
    case WhisperServiceErrorCode.InvalidCloseAction:
    case WhisperServiceErrorCode.InvalidGetSessionHistoryAction:
      throw new httpErrors.BadRequest(err.message)
    case WhisperServiceErrorCode.NoSelfMessaging:
      throw new httpErrors.Forbidden(err.message)
    default:
      assertUnreachable(err.code)
  }
}

async function convertWhisperServiceErrors(ctx: RouterContext, next: Koa.Next) {
  try {
    await next()
  } catch (err) {
    convertWhisperServiceError(err)
  }
}

function getValidatedTargetName(ctx: RouterContext) {
  const {
    params: { targetName },
  } = validateRequest(ctx, {
    params: Joi.object<{ targetName: string }>({
      targetName: Joi.string()
        .min(USERNAME_MINLENGTH)
        .max(USERNAME_MAXLENGTH)
        .pattern(USERNAME_PATTERN)
        .required(),
    }),
  })

  return targetName
}

@httpApi()
export class WhisperApi extends HttpApi {
  constructor() {
    super('/whispers')
    container.resolve(WhisperService)
  }

  applyRoutes(router: Router): void {
    router
      .use(ensureLoggedIn, convertWhisperServiceErrors)
      .post(
        '/:targetName',
        throttleMiddleware(startThrottle, ctx => String(ctx.session!.userId)),
        startWhisperSession,
      )
      .delete(
        '/:targetName',
        throttleMiddleware(closeThrottle, ctx => String(ctx.session!.userId)),
        closeWhisperSession,
      )
      .post(
        '/:targetName/messages',
        throttleMiddleware(sendThrottle, ctx => String(ctx.session!.userId)),
        sendWhisperMessage,
      )
      .get(
        '/:targetName/messages',
        throttleMiddleware(retrievalThrottle, ctx => String(ctx.session!.userId)),
        getSessionHistory,
      )
  }
}

function startWhisperSession(ctx: RouterContext) {
  const targetName = getValidatedTargetName(ctx)

  const whisperService = container.resolve(WhisperService)
  whisperService.startWhisperSession(ctx.session!.userId, targetName)

  ctx.status = 204
}

function closeWhisperSession(ctx: RouterContext) {
  const targetName = getValidatedTargetName(ctx)

  const whisperService = container.resolve(WhisperService)
  whisperService.closeWhisperSession(ctx.session!.userId, targetName)

  ctx.status = 204
}

function sendWhisperMessage(ctx: RouterContext) {
  const targetName = getValidatedTargetName(ctx)
  const {
    body: { message },
  } = validateRequest(ctx, {
    body: Joi.object<{ message: string }>({
      message: Joi.string().min(1).required(),
    }),
  })

  const whisperService = container.resolve(WhisperService)
  whisperService.sendWhisperMessage(ctx.session!.userId, targetName, message)

  ctx.status = 204
}

async function getSessionHistory(ctx: RouterContext) {
  const targetName = getValidatedTargetName(ctx)
  const {
    query: { limit, beforeTime },
  } = validateRequest(ctx, {
    query: Joi.object<{ limit: number; beforeTime: number }>({
      limit: Joi.number().min(1).max(100),
      beforeTime: Joi.number().min(-1),
    }),
  })

  const whisperService = container.resolve(WhisperService)
  ctx.body = await whisperService.getSessionHistory(
    ctx.session!.userId,
    targetName,
    limit,
    beforeTime,
  )
}
