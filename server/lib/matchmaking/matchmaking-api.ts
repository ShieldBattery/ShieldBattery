import { RouterContext } from '@koa/router'
import httpErrors from 'http-errors'
import Joi from 'joi'
import { assertUnreachable } from '../../../common/assert-unreachable'
import {
  AddMatchmakingSeasonResponse,
  FindMatchRequest,
  GetCurrentMatchmakingSeasonResponse,
  GetMatchmakingSeasonsResponse,
  MatchmakingSeasonsServiceErrorCode,
  MatchmakingServiceErrorCode,
  SeasonId,
  ServerAddMatchmakingSeasonRequest,
  toMatchmakingSeasonJson,
} from '../../../common/matchmaking'
import { makeErrorConverterMiddleware } from '../errors/coded-error'
import { asHttpError } from '../errors/error-with-payload'
import { httpApi, httpBeforeAll } from '../http/http-api'
import { httpBefore, httpDelete, httpGet, httpPost } from '../http/route-decorators'
import { getCurrentMapPool } from '../models/matchmaking-map-pools'
import { checkAllPermissions } from '../permissions/check-permissions'
import ensureLoggedIn from '../session/ensure-logged-in'
import createThrottle from '../throttle/create-throttle'
import throttleMiddleware from '../throttle/middleware'
import { joiClientIdentifiers } from '../users/client-ids'
import { UserIdentifierManager } from '../users/user-identifier-manager'
import { validateRequest } from '../validation/joi-validator'
import { filterMapSelections } from './map-vetoes'
import { MatchmakingSeasonsService, MatchmakingSeasonsServiceError } from './matchmaking-seasons'
import { MatchmakingService } from './matchmaking-service'
import { MatchmakingServiceError } from './matchmaking-service-error'
import { matchmakingPreferencesValidator } from './matchmaking-validators'

const matchmakingThrottle = createThrottle('matchmaking', {
  rate: 20,
  burst: 40,
  window: 60000,
})

const convertMatchmakingServiceErrors = makeErrorConverterMiddleware(err => {
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
})

const convertMatchmakingSeasonsServiceErrors = makeErrorConverterMiddleware(err => {
  if (!(err instanceof MatchmakingSeasonsServiceError)) {
    throw err
  }

  switch (err.code) {
    case MatchmakingSeasonsServiceErrorCode.MustBeInFuture:
      throw asHttpError(400, err)
    case MatchmakingSeasonsServiceErrorCode.NotFound:
      throw asHttpError(404, err)
    default:
      assertUnreachable(err.code)
  }
})

@httpApi('/matchmaking')
@httpBeforeAll(
  ensureLoggedIn,
  convertMatchmakingServiceErrors,
  convertMatchmakingSeasonsServiceErrors,
)
export class MatchmakingApi {
  constructor(
    private matchmakingService: MatchmakingService,
    private userIdManager: UserIdentifierManager,
    private matchmakingSeasonsService: MatchmakingSeasonsService,
  ) {}

  @httpPost('/find')
  @httpBefore(throttleMiddleware(matchmakingThrottle, ctx => String(ctx.session!.user!.id)))
  async findMatch(ctx: RouterContext): Promise<void> {
    const { body } = validateRequest(ctx, {
      body: Joi.object<FindMatchRequest>({
        clientId: Joi.string().required(),
        preferences: matchmakingPreferencesValidator(
          ctx.session!.user!.id,
          false /* allowPartial */,
        ).required(),
        identifiers: joiClientIdentifiers().required(),
      }),
    })
    const { clientId, preferences, identifiers } = body

    const currentMapPool = await getCurrentMapPool(preferences.matchmakingType)
    if (!currentMapPool) {
      throw new MatchmakingServiceError(
        MatchmakingServiceErrorCode.InvalidMapPool,
        "Map pool doesn't exist",
      )
    }

    await this.userIdManager.upsert(ctx.session!.user!.id, identifiers)

    if (await this.userIdManager.banUserIfNeeded(ctx.session!.user!.id)) {
      throw new httpErrors.Unauthorized('This account is banned')
    }

    await this.matchmakingService.find(ctx.session!.user!.id, clientId, identifiers, {
      ...preferences,
      mapSelections: filterMapSelections(currentMapPool, preferences.mapSelections),
    })
  }

  @httpDelete('/find')
  @httpBefore(throttleMiddleware(matchmakingThrottle, ctx => String(ctx.session!.user!.id)))
  async cancelSearch(ctx: RouterContext): Promise<void> {
    await this.matchmakingService.cancel(ctx.session!.user!.id)
  }

  @httpPost('/accept')
  @httpBefore(throttleMiddleware(matchmakingThrottle, ctx => String(ctx.session!.user!.id)))
  async acceptMatch(ctx: RouterContext): Promise<void> {
    await this.matchmakingService.accept(ctx.session!.user!.id)
  }

  @httpGet('/seasons')
  @httpBefore(checkAllPermissions('manageMatchmakingSeasons'))
  async getMatchmakingSeasons(ctx: RouterContext): Promise<GetMatchmakingSeasonsResponse> {
    return {
      seasons: (await this.matchmakingSeasonsService.getAllSeasons()).map(s =>
        toMatchmakingSeasonJson(s),
      ),
      current: (await this.matchmakingSeasonsService.getCurrentSeason()).id,
    }
  }

  @httpGet('/seasons/current')
  async getCurrentMatchmakingSeason(
    ctx: RouterContext,
  ): Promise<GetCurrentMatchmakingSeasonResponse> {
    return {
      season: toMatchmakingSeasonJson(await this.matchmakingSeasonsService.getCurrentSeason()),
    }
  }

  @httpPost('/seasons')
  @httpBefore(checkAllPermissions('manageMatchmakingSeasons'))
  async addMatchmakingSeason(ctx: RouterContext): Promise<AddMatchmakingSeasonResponse> {
    const { body } = validateRequest(ctx, {
      body: Joi.object<ServerAddMatchmakingSeasonRequest>({
        startDate: Joi.date().timestamp().min(Date.now()).required(),
        name: Joi.string().required(),
        resetMmr: Joi.boolean().required(),
      }),
    })

    return {
      season: toMatchmakingSeasonJson(await this.matchmakingSeasonsService.addSeason(body)),
    }
  }

  @httpDelete('/seasons/:id')
  @httpBefore(checkAllPermissions('manageMatchmakingSeasons'))
  async deleteMatchmakingSeason(ctx: RouterContext): Promise<void> {
    const { params } = validateRequest(ctx, {
      params: Joi.object<{ id: SeasonId }>({
        id: Joi.number().min(1).required(),
      }),
    })

    await this.matchmakingSeasonsService.deleteSeason(params.id)
  }
}
