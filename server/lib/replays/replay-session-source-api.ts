import { RouterContext } from '@koa/router'
import httpErrors from 'http-errors'
import { container } from 'tsyringe'
import { StageReplaySessionSourceResponse } from '../../../common/replay-sessions'
import { makeErrorConverterMiddleware } from '../errors/coded-error'
import { asHttpError } from '../errors/error-with-payload'
import { handleMultipartFiles } from '../files/handle-multipart-files'
import { httpApi, httpBeforeAll } from '../http/http-api'
import { httpBefore, httpPost } from '../http/route-decorators'
import ensureLoggedIn from '../session/ensure-logged-in'
import createThrottle from '../throttle/create-throttle'
import throttleMiddleware, { throttleByUserOrIp } from '../throttle/middleware'
import { ReplaySessionSourceCleanupJob } from './replay-session-source-cleanup'
import {
  ReplaySessionSourceError,
  ReplaySessionSourceErrorCode,
  ReplaySessionSourceService,
} from './replay-session-source-service'

const MAX_REPLAY_SIZE_BYTES = 5 * 1024 * 1024

const sourceUploadThrottle = createThrottle('replaySessionSourceUpload', {
  rate: 2,
  burst: 4,
  window: 60_000,
})

function convertReplaySessionSourceError(err: unknown): void {
  if (!(err instanceof ReplaySessionSourceError)) {
    throw err
  }

  switch (err.code) {
    case ReplaySessionSourceErrorCode.InvalidReplay:
      throw asHttpError(400, err)
    default:
      err.code satisfies never
  }
}

@httpApi('/replay-sessions')
@httpBeforeAll(makeErrorConverterMiddleware(convertReplaySessionSourceError))
export class ReplaySessionSourceApi {
  constructor(private sourceService: ReplaySessionSourceService) {
    container.resolve(ReplaySessionSourceCleanupJob)
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
}
