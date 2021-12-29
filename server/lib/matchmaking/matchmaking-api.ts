import { RouterContext } from '@koa/router'
import Joi from 'joi'
import Koa from 'koa'
import { assertUnreachable } from '../../../common/assert-unreachable'
import { MatchmakingPreferences, MatchmakingServiceErrorCode } from '../../../common/matchmaking'
import { asHttpError } from '../errors/error-with-payload'
import { httpApi, httpBeforeAll } from '../http/http-api'
import { httpBefore, httpDelete, httpPost } from '../http/route-decorators'
import ensureLoggedIn from '../session/ensure-logged-in'
import { updateAllSessionsForCurrentUser } from '../session/update-all-sessions'
import createThrottle from '../throttle/create-throttle'
import throttleMiddleware from '../throttle/middleware'
import { validateRequest } from '../validation/joi-validator'
import { MatchmakingService } from './matchmaking-service'
import { MatchmakingServiceError } from './matchmaking-service-error'
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
      throw asHttpError(404, err)
    case MatchmakingServiceErrorCode.InvalidMapPool:
    case MatchmakingServiceErrorCode.InvalidMaps:
    case MatchmakingServiceErrorCode.ClientDisconnected:
    case MatchmakingServiceErrorCode.InvalidClient:
    case MatchmakingServiceErrorCode.TooManyPlayers:
      throw asHttpError(400, err)
    case MatchmakingServiceErrorCode.MatchmakingDisabled:
      throw asHttpError(403, err)
    case MatchmakingServiceErrorCode.NotInQueue:
    case MatchmakingServiceErrorCode.NoActiveMatch:
    case MatchmakingServiceErrorCode.GameplayConflict:
    case MatchmakingServiceErrorCode.InParty:
    case MatchmakingServiceErrorCode.MatchAlreadyStarting:
      throw asHttpError(409, err)
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
    await updateAllSessionsForCurrentUser(ctx, {
      lastQueuedMatchmakingType: preferences.matchmakingType,
    })
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
