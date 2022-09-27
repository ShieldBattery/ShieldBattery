import { RouterContext } from '@koa/router'
import Joi from 'joi'
import { container } from 'tsyringe'
import { assertUnreachable } from '../../../common/assert-unreachable'
import { SbUserId } from '../../../common/users/sb-user'
import {
  GetSessionHistoryResponse,
  SendWhisperMessageRequest,
  WhisperServiceErrorCode,
} from '../../../common/whispers'
import { makeErrorConverterMiddleware } from '../errors/coded-error'
import { asHttpError } from '../errors/error-with-payload'
import { httpApi, httpBeforeAll } from '../http/http-api'
import { httpBefore, httpDelete, httpGet, httpPost } from '../http/route-decorators'
import ensureLoggedIn from '../session/ensure-logged-in'
import createThrottle from '../throttle/create-throttle'
import throttleMiddleware from '../throttle/middleware'
import { findUserByName } from '../users/user-model'
import { joiUserId, joiUsername } from '../users/user-validators'
import { validateRequest } from '../validation/joi-validator'
import WhisperService, { WhisperServiceError } from './whisper-service'

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

const convertWhisperServiceErrors = makeErrorConverterMiddleware(err => {
  if (!(err instanceof WhisperServiceError)) {
    throw err
  }

  switch (err.code) {
    case WhisperServiceErrorCode.UserNotFound:
      throw asHttpError(404, err)
    case WhisperServiceErrorCode.InvalidGetSessionHistoryAction:
      throw asHttpError(400, err)
    case WhisperServiceErrorCode.NoSelfMessaging:
      throw asHttpError(403, err)
    default:
      assertUnreachable(err.code)
  }
})

@httpApi('/whispers')
@httpBeforeAll(ensureLoggedIn, convertWhisperServiceErrors)
export class WhisperApi {
  constructor(private whisperService: WhisperService) {
    container.resolve(WhisperService)
  }

  @httpPost('/by-name/:targetName')
  @httpBefore(throttleMiddleware(startThrottle, ctx => String(ctx.session!.userId)))
  async startWhisperSessionByName(ctx: RouterContext): Promise<{ userId: SbUserId }> {
    const {
      params: { targetName },
    } = validateRequest(ctx, {
      params: Joi.object<{ targetName: string }>({
        targetName: joiUsername().required(),
      }),
    })

    const targetUser = await findUserByName(targetName)

    if (!targetUser) {
      throw new WhisperServiceError(WhisperServiceErrorCode.UserNotFound, 'user not found')
    }

    await this.whisperService.startWhisperSession(ctx.session!.userId, targetUser.id)

    return { userId: targetUser.id }
  }

  @httpPost('/:targetId')
  @httpBefore(throttleMiddleware(startThrottle, ctx => String(ctx.session!.userId)))
  async startWhisperSessionById(ctx: RouterContext): Promise<void> {
    const {
      params: { targetId },
    } = validateRequest(ctx, {
      params: Joi.object<{ targetId: SbUserId }>({
        targetId: joiUserId().required(),
      }),
    })

    await this.whisperService.startWhisperSession(ctx.session!.userId, targetId)

    ctx.status = 204
  }

  @httpDelete('/:targetId')
  @httpBefore(throttleMiddleware(closeThrottle, ctx => String(ctx.session!.userId)))
  async closeWhisperSession(ctx: RouterContext): Promise<void> {
    const {
      params: { targetId },
    } = validateRequest(ctx, {
      params: Joi.object<{ targetId: SbUserId }>({
        targetId: joiUserId().required(),
      }),
    })

    await this.whisperService.closeWhisperSession(ctx.session!.userId, targetId)

    ctx.status = 204
  }

  @httpPost('/:targetId/messages')
  @httpBefore(throttleMiddleware(sendThrottle, ctx => String(ctx.session!.userId)))
  async sendWhisperMessage(ctx: RouterContext): Promise<void> {
    const {
      params: { targetId },
      body: { message },
    } = validateRequest(ctx, {
      params: Joi.object<{ targetId: SbUserId }>({
        targetId: joiUserId().required(),
      }),
      body: Joi.object<SendWhisperMessageRequest>({
        message: Joi.string().min(1).required(),
      }),
    })

    await this.whisperService.sendWhisperMessage(ctx.session!.userId, targetId, message)

    ctx.status = 204
  }

  // Leaving the old API with a dummy payload in order to not break the auto-update functionality
  // for old clients.
  // Last used: 8.0.2 (November 2021)
  @httpGet('/:targetName/messages')
  @httpBefore(throttleMiddleware(retrievalThrottle, ctx => String(ctx.session!.userId)))
  getSessionHistoryOld(ctx: RouterContext): Omit<GetSessionHistoryResponse, 'mentions'> {
    return {
      messages: [],
      users: [],
    }
  }

  @httpGet('/:targetId/messages2')
  @httpBefore(throttleMiddleware(retrievalThrottle, ctx => String(ctx.session!.userId)))
  async getSessionHistory(ctx: RouterContext): Promise<GetSessionHistoryResponse> {
    const {
      params: { targetId },
      query: { limit, beforeTime },
    } = validateRequest(ctx, {
      params: Joi.object<{ targetId: SbUserId }>({
        targetId: joiUserId().required(),
      }),
      query: Joi.object<{ limit: number; beforeTime: number }>({
        limit: Joi.number().min(1).max(100),
        beforeTime: Joi.number().min(-1),
      }),
    })

    return await this.whisperService.getSessionHistory(
      ctx.session!.userId,
      targetId,
      limit,
      beforeTime,
    )
  }
}
