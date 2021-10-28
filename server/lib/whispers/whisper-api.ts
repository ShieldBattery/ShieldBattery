import { RouterContext } from '@koa/router'
import httpErrors from 'http-errors'
import Joi from 'joi'
import Koa from 'koa'
import { container } from 'tsyringe'
import { assertUnreachable } from '../../../common/assert-unreachable'
import { USERNAME_MAXLENGTH, USERNAME_MINLENGTH, USERNAME_PATTERN } from '../../../common/constants'
import {
  GetSessionHistoryServerPayload,
  SendWhisperMessageServerBody,
} from '../../../common/whispers'
import { httpApi, httpBeforeAll } from '../http/http-api'
import { httpBefore, httpDelete, httpGet, httpPost } from '../http/route-decorators'
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

function convertWhisperServiceError(err: unknown) {
  if (!(err instanceof WhisperServiceError)) {
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

@httpApi('/whispers')
@httpBeforeAll(ensureLoggedIn, convertWhisperServiceErrors)
export class WhisperApi {
  constructor(private whisperService: WhisperService) {
    container.resolve(WhisperService)
  }

  @httpPost('/:targetName')
  @httpBefore(throttleMiddleware(startThrottle, ctx => String(ctx.session!.userId)))
  async startWhisperSession(ctx: RouterContext): Promise<void> {
    const targetName = getValidatedTargetName(ctx)

    await this.whisperService.startWhisperSession(ctx.session!.userId, targetName)

    ctx.status = 204
  }

  @httpDelete('/:targetName')
  @httpBefore(throttleMiddleware(closeThrottle, ctx => String(ctx.session!.userId)))
  async closeWhisperSession(ctx: RouterContext): Promise<void> {
    const targetName = getValidatedTargetName(ctx)

    await this.whisperService.closeWhisperSession(ctx.session!.userId, targetName)

    ctx.status = 204
  }

  @httpPost('/:targetName/messages')
  @httpBefore(throttleMiddleware(sendThrottle, ctx => String(ctx.session!.userId)))
  async sendWhisperMessage(ctx: RouterContext): Promise<void> {
    const targetName = getValidatedTargetName(ctx)
    const {
      body: { message },
    } = validateRequest(ctx, {
      body: Joi.object<SendWhisperMessageServerBody>({
        message: Joi.string().min(1).required(),
      }),
    })

    await this.whisperService.sendWhisperMessage(ctx.session!.userId, targetName, message)

    ctx.status = 204
  }

  @httpGet('/:targetName/messages')
  @httpBefore(throttleMiddleware(retrievalThrottle, ctx => String(ctx.session!.userId)))
  getSessionHistoryOld(ctx: RouterContext): Omit<GetSessionHistoryServerPayload, 'mentions'> {
    return {
      messages: [],
      users: [],
    }
  }

  @httpGet('/:targetName/messages2')
  @httpBefore(throttleMiddleware(retrievalThrottle, ctx => String(ctx.session!.userId)))
  async getSessionHistory(ctx: RouterContext): Promise<GetSessionHistoryServerPayload> {
    const targetName = getValidatedTargetName(ctx)
    const {
      query: { limit, beforeTime },
    } = validateRequest(ctx, {
      query: Joi.object<{ limit: number; beforeTime: number }>({
        limit: Joi.number().min(1).max(100),
        beforeTime: Joi.number().min(-1),
      }),
    })

    return await this.whisperService.getSessionHistory(
      ctx.session!.userId,
      targetName,
      limit,
      beforeTime,
    )
  }
}
