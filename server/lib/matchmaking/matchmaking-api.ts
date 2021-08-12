import Router, { RouterContext } from '@koa/router'
import httpErrors from 'http-errors'
import Joi from 'joi'
import Koa from 'koa'
import { singleton } from 'tsyringe'
import { assertUnreachable } from '../../../common/assert-unreachable'
import {
  ALL_MATCHMAKING_TYPES,
  MatchmakingPreferences,
  MatchmakingPreferencesData1v1,
} from '../../../common/matchmaking'
import { httpApi, HttpApi } from '../http/http-api'
import { apiEndpoint } from '../http/http-api-endpoint'
import ensureLoggedIn from '../session/ensure-logged-in'
import updateAllSessions from '../session/update-all-sessions'
import createThrottle from '../throttle/create-throttle'
import throttleMiddleware from '../throttle/middleware'
import {
  MatchmakingService,
  MatchmakingServiceError,
  MatchmakingServiceErrorCode,
} from './matchmaking-service'

const matchmakingThrottle = createThrottle('matchmaking', {
  rate: 20,
  burst: 40,
  window: 60000,
})

function convertMatchmakingServiceError(err: Error) {
  if (!(err instanceof MatchmakingServiceError)) {
    throw err
  }

  switch (err.code) {
    case MatchmakingServiceErrorCode.UserOffline:
      throw new httpErrors.NotFound(err.message)
    case MatchmakingServiceErrorCode.InvalidMapPool:
    case MatchmakingServiceErrorCode.InvalidMaps:
    case MatchmakingServiceErrorCode.ClientDisconnected:
    case MatchmakingServiceErrorCode.NotInQueue:
    case MatchmakingServiceErrorCode.NoActiveMatch:
    case MatchmakingServiceErrorCode.InvalidClient:
      throw new httpErrors.BadRequest(err.message)
    case MatchmakingServiceErrorCode.MatchmakingDisabled:
      throw new httpErrors.Forbidden(err.message)
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

@httpApi()
@singleton()
export class MatchmakingApi extends HttpApi {
  constructor(private matchmakingService: MatchmakingService) {
    super('/matchmaking')
  }

  protected applyRoutes(router: Router): void {
    router
      .use(ensureLoggedIn, convertMatchmakingServiceErrors)
      .post(
        '/find',
        throttleMiddleware(matchmakingThrottle, ctx => String(ctx.session!.userId)),
        this.findMatch,
      )
      .delete(
        '/',
        throttleMiddleware(matchmakingThrottle, ctx => String(ctx.session!.userId)),
        this.cancelSearch,
      )
      .post(
        '/',
        throttleMiddleware(matchmakingThrottle, ctx => String(ctx.session!.userId)),
        this.acceptMatch,
      )
  }

  findMatch = apiEndpoint(
    {
      body: Joi.object({
        clientId: Joi.string().required(),
        preferences: Joi.object<MatchmakingPreferences>({
          userId: Joi.number().min(1).required(),
          matchmakingType: Joi.valid(...ALL_MATCHMAKING_TYPES).required(),
          race: Joi.string().valid('p', 't', 'z', 'r').required(),
          mapPoolId: Joi.number().min(1).required(),
          // TODO(2Pac): min/max values most likely depend on the matchmaking type here
          mapSelections: Joi.array().items(Joi.string()).min(0).max(2).required(),
          data: Joi.alternatives()
            .try(
              Joi.object<MatchmakingPreferencesData1v1>({
                useAlternateRace: Joi.bool(),
                alternateRace: Joi.string().valid('p', 't', 'z'),
              }),
            )
            .required(),
        }),
      }),
    },
    async (ctx, { body }) => {
      const { clientId, preferences } = body

      await this.matchmakingService.find(ctx.session!.userId, clientId, preferences)

      // Save the last queued matchmaking type on the user's session
      await updateAllSessions(ctx, { lastQueuedMatchmakingType: preferences.matchmakingType })
    },
  )

  cancelSearch = apiEndpoint({}, async ctx => {
    await this.matchmakingService.cancel(ctx.session!.userId)
  })

  acceptMatch = apiEndpoint({}, async ctx => {
    await this.matchmakingService.accept(ctx.session!.userId)
  })
}
