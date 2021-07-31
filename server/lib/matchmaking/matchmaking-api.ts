import Router, { RouterContext } from '@koa/router'
import httpErrors from 'http-errors'
import Joi from 'joi'
import Koa from 'koa'
import { container } from 'tsyringe'
import { assertUnreachable } from '../../../common/assert-unreachable'
import { ALL_MATCHMAKING_TYPES } from '../../../common/matchmaking'
import { httpApi, HttpApi } from '../http/http-api'
import ensureLoggedIn from '../session/ensure-logged-in'
import createThrottle from '../throttle/create-throttle'
import throttleMiddleware from '../throttle/middleware'
import { validateRequest } from '../validation/joi-validator'
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
export class MatchmakingApi extends HttpApi {
  constructor() {
    super('/matchmaking')
    container.resolve(MatchmakingService)
  }

  applyRoutes(router: Router): void {
    router
      .use(ensureLoggedIn, convertMatchmakingServiceErrors)
      .post(
        '/find',
        throttleMiddleware(matchmakingThrottle, ctx => String(ctx.session!.userId)),
        findMatch,
      )
      .delete(
        '/',
        throttleMiddleware(matchmakingThrottle, ctx => String(ctx.session!.userId)),
        cancelSearch,
      )
      .post(
        '/',
        throttleMiddleware(matchmakingThrottle, ctx => String(ctx.session!.userId)),
        acceptMatch,
      )
  }
}

async function findMatch(ctx: RouterContext) {
  const {
    body: { clientId, type, race, useAlternateRace, alternateRace, preferredMaps },
  } = validateRequest(ctx, {
    body: Joi.object({
      clientId: Joi.string().required(),
      type: Joi.valid(...ALL_MATCHMAKING_TYPES).required(),
      race: Joi.string().valid('p', 't', 'z', 'r').required(),
      useAlternateRace: Joi.bool().required(),
      alternateRace: Joi.string().valid('p', 't', 'z').required(),
      preferredMaps: Joi.array().items(Joi.string()).min(0).max(2).required(),
    }),
  })

  const matchmakingService = container.resolve(MatchmakingService)
  await matchmakingService.find(
    ctx.session!.userId,
    clientId,
    type,
    race,
    useAlternateRace,
    alternateRace,
    preferredMaps,
  )

  ctx.status = 204
}

async function cancelSearch(ctx: RouterContext) {
  const matchmakingService = container.resolve(MatchmakingService)
  await matchmakingService.cancel(ctx.session!.userId)

  ctx.status = 204
}

async function acceptMatch(ctx: RouterContext) {
  const matchmakingService = container.resolve(MatchmakingService)
  await matchmakingService.accept(ctx.session!.userId)

  ctx.status = 204
}
