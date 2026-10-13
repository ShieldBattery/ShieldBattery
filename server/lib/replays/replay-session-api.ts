import { RouterContext } from '@koa/router'
import httpErrors from 'http-errors'
import Joi from 'joi'
import { container } from 'tsyringe'
import { assertUnreachable } from '../../../common/assert-unreachable'
import { CHAT_MESSAGE_MAXLENGTH } from '../../../common/constants'
import { isPrettyId } from '../../../common/pretty-id'
import {
  CreateReplaySessionRequest,
  CreateReplaySessionResponse,
  GetReplaySessionSourceResponse,
  InviteToReplaySessionRequest,
  ReplaySessionClientRequest,
  ReplaySessionErrorCode,
  ReplaySessionSource,
  ReportReplaySessionLoadedRequest,
  SbReplaySessionId,
  SendReplaySessionChatRequest,
  StageReplaySessionSourceResponse,
} from '../../../common/replay-sessions'
import { SbUserId } from '../../../common/users/sb-user-id'
import { makeErrorConverterMiddleware } from '../errors/coded-error'
import { asHttpError } from '../errors/error-with-payload'
import { handleMultipartFiles } from '../files/handle-multipart-files'
import { httpApi, httpBeforeAll } from '../http/http-api'
import { httpBefore, httpGet, httpPost } from '../http/route-decorators'
import { JobScheduler } from '../jobs/job-scheduler'
import ensureLoggedIn from '../session/ensure-logged-in'
import createThrottle from '../throttle/create-throttle'
import throttleMiddleware, { throttleByUser, throttleByUserOrIp } from '../throttle/middleware'
import { joiUserId } from '../users/user-validators'
import { validateRequest } from '../validation/joi-validator'
import { ClientSocketsGroup, ClientSocketsManager } from '../websockets/socket-groups'
import { ReplaySessionService, ReplaySessionServiceError } from './replay-session-service'
import { ReplaySessionSourceCleanupJob } from './replay-session-source-cleanup'
import {
  ReplaySessionSourceError,
  ReplaySessionSourceErrorCode,
  ReplaySessionSourceService,
} from './replay-session-source-service'

const MAX_REPLAY_SIZE_BYTES = 5 * 1024 * 1024

/**
 * How often sessions playing an uploaded replay push its expiry back out. This is far shorter than
 * a source's lifetime, so a source stays alive through several missed runs.
 */
const SOURCE_RETENTION_INTERVAL_MS = 60 * 60 * 1000

const sourceUploadThrottle = createThrottle('replaySessionSourceUpload', {
  rate: 2,
  burst: 4,
  window: 60_000,
})

const sessionThrottle = createThrottle('replaySessions', {
  rate: 40,
  burst: 120,
  window: 60_000,
})

const sessionChatThrottle = createThrottle('replaySessions/chat', {
  rate: 30,
  burst: 90,
  window: 60_000,
})

const authed = [ensureLoggedIn, throttleMiddleware(sessionThrottle, throttleByUser)]

const sessionIdParams = Joi.object<{ sessionId: SbReplaySessionId }>({
  sessionId: Joi.string()
    .custom((value, helpers) => (isPrettyId(value) ? value : helpers.error('any.invalid')))
    .required(),
})

const clientIdSchema = Joi.string().required()

const sessionClientBody = Joi.object<ReplaySessionClientRequest>({
  clientId: clientIdSchema,
})

const sourceSchema = Joi.alternatives<ReplaySessionSource>().try(
  Joi.object({ kind: Joi.valid('game').required(), gameId: Joi.string().required() }),
  Joi.object({ kind: Joi.valid('upload').required(), sourceId: Joi.string().uuid().required() }),
)

function convertReplaySessionErrors(err: unknown): void {
  if (err instanceof ReplaySessionSourceError) {
    switch (err.code) {
      case ReplaySessionSourceErrorCode.InvalidReplay:
        throw asHttpError(400, err)
      default:
        return assertUnreachable(err.code)
    }
  }

  if (!(err instanceof ReplaySessionServiceError)) {
    throw err
  }

  switch (err.code) {
    case ReplaySessionErrorCode.HashMismatch:
    case ReplaySessionErrorCode.NoActiveClient:
      throw asHttpError(400, err)

    case ReplaySessionErrorCode.ChatRestricted:
    case ReplaySessionErrorCode.NotHost:
    case ReplaySessionErrorCode.NotInvited:
    case ReplaySessionErrorCode.ReplayNotAccessible:
    case ReplaySessionErrorCode.TargetCannotAccessReplay:
      throw asHttpError(403, err)

    case ReplaySessionErrorCode.SessionNotFound:
    case ReplaySessionErrorCode.SourceNotFound:
      throw asHttpError(404, err)

    case ReplaySessionErrorCode.AlreadyInSession:
    case ReplaySessionErrorCode.AlreadyStarted:
    case ReplaySessionErrorCode.NotInSession:
    case ReplaySessionErrorCode.NotLoading:
      throw asHttpError(409, err)

    default:
      return assertUnreachable(err.code)
  }
}

/**
 * Every client-initiated replay session operation. Session state reaches members over the session's
 * socket channel; these endpoints only change it.
 *
 * Session membership is per-client, so each request that acts within a session names the client
 * it comes from, and the route's `:sessionId` is asserted against that client's session.
 */
@httpApi('/replay-sessions')
@httpBeforeAll(makeErrorConverterMiddleware(convertReplaySessionErrors))
export class ReplaySessionApi {
  constructor(
    private sourceService: ReplaySessionSourceService,
    private sessionService: ReplaySessionService,
    private clientSocketsManager: ClientSocketsManager,
    jobScheduler: JobScheduler,
  ) {
    container.resolve(ReplaySessionSourceCleanupJob)
    jobScheduler.scheduleImmediateJob(
      'lib/replays#replaySessionSourceRetention',
      SOURCE_RETENTION_INTERVAL_MS,
      () => sessionService.retainUploadedSources(),
    )
  }

  @httpPost('/sources')
  @httpBefore(
    ensureLoggedIn,
    throttleMiddleware(sourceUploadThrottle, throttleByUserOrIp),
    handleMultipartFiles(MAX_REPLAY_SIZE_BYTES),
  )
  async stageSource(ctx: RouterContext): Promise<StageReplaySessionSourceResponse> {
    const replayFile = ctx.request.files?.replay
    if (!replayFile || Array.isArray(replayFile)) {
      throw new httpErrors.BadRequest('exactly one replay file must be uploaded')
    }

    return await this.sourceService.stageUpload(replayFile.filepath, ctx.session!.user.id)
  }

  @httpPost('/')
  @httpBefore(...authed)
  async createSession(ctx: RouterContext): Promise<CreateReplaySessionResponse> {
    const { body } = validateRequest(ctx, {
      body: Joi.object<CreateReplaySessionRequest>({
        clientId: clientIdSchema,
        source: sourceSchema.required(),
      }),
    })

    const client = this.getClientSockets(ctx.session!.user.id, body.clientId)
    return { session: await this.sessionService.createSession({ client, source: body.source }) }
  }

  @httpPost('/:sessionId/invite')
  @httpBefore(...authed)
  async invite(ctx: RouterContext): Promise<void> {
    const { params, body } = validateRequest(ctx, {
      params: sessionIdParams,
      body: Joi.object<InviteToReplaySessionRequest>({
        clientId: clientIdSchema,
        targetId: joiUserId().required(),
      }),
    })

    const client = this.getClientSockets(ctx.session!.user.id, body.clientId)
    await this.sessionService.invite({
      client,
      sessionId: params.sessionId,
      targetId: body.targetId,
    })
  }

  @httpPost('/:sessionId/decline')
  @httpBefore(...authed)
  async declineInvite(ctx: RouterContext): Promise<void> {
    const { params } = validateRequest(ctx, { params: sessionIdParams })

    this.sessionService.declineInvite({
      userId: ctx.session!.user.id,
      sessionId: params.sessionId,
    })
  }

  @httpPost('/:sessionId/join')
  @httpBefore(...authed)
  async joinSession(ctx: RouterContext): Promise<CreateReplaySessionResponse> {
    const { params, body } = validateRequest(ctx, {
      params: sessionIdParams,
      body: sessionClientBody,
    })

    const client = this.getClientSockets(ctx.session!.user.id, body.clientId)
    return {
      session: await this.sessionService.joinSession({ client, sessionId: params.sessionId }),
    }
  }

  @httpPost('/:sessionId/start')
  @httpBefore(...authed)
  async start(ctx: RouterContext): Promise<void> {
    const { params, body } = validateRequest(ctx, {
      params: sessionIdParams,
      body: sessionClientBody,
    })

    const client = this.getClientSockets(ctx.session!.user.id, body.clientId)
    this.sessionService.start({ client, sessionId: params.sessionId })
  }

  @httpPost('/:sessionId/loaded')
  @httpBefore(...authed)
  async reportLoaded(ctx: RouterContext): Promise<void> {
    const { params, body } = validateRequest(ctx, {
      params: sessionIdParams,
      body: Joi.object<ReportReplaySessionLoadedRequest>({
        clientId: clientIdSchema,
        hash: Joi.string().hex().length(64).required(),
      }),
    })

    const client = this.getClientSockets(ctx.session!.user.id, body.clientId)
    this.sessionService.reportLoaded({ client, sessionId: params.sessionId, hash: body.hash })
  }

  @httpPost('/:sessionId/leave')
  @httpBefore(...authed)
  async leaveSession(ctx: RouterContext): Promise<void> {
    const { params, body } = validateRequest(ctx, {
      params: sessionIdParams,
      body: sessionClientBody,
    })

    const client = this.getClientSockets(ctx.session!.user.id, body.clientId)
    this.sessionService.leaveSession({ client, sessionId: params.sessionId })
  }

  @httpPost('/:sessionId/close')
  @httpBefore(...authed)
  async closeSession(ctx: RouterContext): Promise<void> {
    const { params, body } = validateRequest(ctx, {
      params: sessionIdParams,
      body: sessionClientBody,
    })

    const client = this.getClientSockets(ctx.session!.user.id, body.clientId)
    this.sessionService.closeSession({ client, sessionId: params.sessionId })
  }

  @httpPost('/:sessionId/chat')
  @httpBefore(ensureLoggedIn, throttleMiddleware(sessionChatThrottle, throttleByUser))
  async sendChat(ctx: RouterContext): Promise<void> {
    const { params, body } = validateRequest(ctx, {
      params: sessionIdParams,
      body: Joi.object<SendReplaySessionChatRequest>({
        clientId: clientIdSchema,
        text: Joi.string().min(1).max(CHAT_MESSAGE_MAXLENGTH).required(),
      }),
    })

    const client = this.getClientSockets(ctx.session!.user.id, body.clientId)
    await this.sessionService.sendChat({ client, sessionId: params.sessionId, text: body.text })
  }

  @httpGet('/:sessionId/source')
  @httpBefore(...authed)
  async getSource(ctx: RouterContext): Promise<GetReplaySessionSourceResponse> {
    const { params } = validateRequest(ctx, { params: sessionIdParams })

    return await this.sessionService.getSourceDownload({
      userId: ctx.session!.user.id,
      sessionId: params.sessionId,
    })
  }

  private getClientSockets(userId: SbUserId, clientId: string): ClientSocketsGroup {
    const client = this.clientSocketsManager.getById(userId, clientId)
    if (!client) {
      throw new ReplaySessionServiceError(
        ReplaySessionErrorCode.NoActiveClient,
        'no socket connection for that client',
      )
    }
    return client
  }
}
