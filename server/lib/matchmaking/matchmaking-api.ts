import { RouterContext } from '@koa/router'
import httpErrors from 'http-errors'
import Joi from 'joi'
import Koa from 'koa'
import { assertUnreachable } from '../../../common/assert-unreachable'
import { MatchmakingPreferences } from '../../../common/matchmaking'
import { httpApi, httpBeforeAll } from '../http/http-api'
import { httpBefore, httpDelete, httpPost } from '../http/route-decorators'
import ensureLoggedIn from '../session/ensure-logged-in'
import updateAllSessions from '../session/update-all-sessions'
import createThrottle from '../throttle/create-throttle'
import throttleMiddleware from '../throttle/middleware'
import { validateRequest } from '../validation/joi-validator'
import {
  MatchmakingService,
  MatchmakingServiceError,
  MatchmakingServiceErrorCode,
} from './matchmaking-service'
import { matchmakingPreferencesValidator } from './matchmaking-validators'

const matchmakingThrottle = createThrottle('matchmaking', {
  rate: 20,
  burst: 40,
  window: 60000,
})

function convertMatchmakingServiceError(err: unknown) {
  if (!(err instanceof MatchmakingServiceError)) {
    throw err
  }

  switch (err.code) {
    case MatchmakingServiceErrorCode.UserOffline:
      throw new httpErrors.NotFound(err.message)
    case MatchmakingServiceErrorCode.InvalidMapPool:
    case MatchmakingServiceErrorCode.InvalidMaps:
    case MatchmakingServiceErrorCode.ClientDisconnected:
    case MatchmakingServiceErrorCode.InvalidClient:
      throw new httpErrors.BadRequest(err.message)
    case MatchmakingServiceErrorCode.MatchmakingDisabled:
      throw new httpErrors.Forbidden(err.message)
    case MatchmakingServiceErrorCode.NotInQueue:
    case MatchmakingServiceErrorCode.NoActiveMatch:
    case MatchmakingServiceErrorCode.GameplayConflict:
      throw new httpErrors.Conflict(err.message)
    default:
      assertUnreachable(err.code)
  }
}

async function convertMatchmakingServiceErrors(ctx: RouterContext, next: Koa.Next) {
  try {
    await next()
  } catch (err) {
    convertMatchmakingServiceError(err)
  }
}

@httpApi('/matchmaking')
@httpBeforeAll(ensureLoggedIn, convertMatchmakingServiceErrors)
export class MatchmakingApi {
  constructor(private matchmakingService: MatchmakingService) {}

  @httpPost('/find')
  @httpBefore(throttleMiddleware(matchmakingThrottle, ctx => String(ctx.session!.userId)))
  async findMatch(ctx: RouterContext): Promise<void> {
    const { body } = validateRequest(ctx, {
      body: Joi.object<{ clientId: string; preferences: MatchmakingPreferences }>({
        clientId: Joi.string().required(),
        preferences: matchmakingPreferencesValidator(ctx.session!.userId).required(),
      }),
    })
    const { clientId, preferences } = body

    await this.matchmakingService.find(ctx.session!.userId, clientId, preferences)

    // Save the last queued matchmaking type on the user's session
    await updateAllSessions(ctx, { lastQueuedMatchmakingType: preferences.matchmakingType })
  }

  @httpDelete('/find')
  @httpBefore(throttleMiddleware(matchmakingThrottle, ctx => String(ctx.session!.userId)))
  async cancelSearch(ctx: RouterContext): Promise<void> {
    await this.matchmakingService.cancel(ctx.session!.userId)
  }

  @httpPost('/accept')
  @httpBefore(throttleMiddleware(matchmakingThrottle, ctx => String(ctx.session!.userId)))
  async acceptMatch(ctx: RouterContext): Promise<void> {
    await this.matchmakingService.accept(ctx.session!.userId)
  }
}
