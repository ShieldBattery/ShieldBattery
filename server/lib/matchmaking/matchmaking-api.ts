import { RouterContext } from '@koa/router'
import httpErrors from 'http-errors'
import Joi from 'joi'
import { assertUnreachable } from '../../../common/assert-unreachable'
import {
  AddMatchmakingSeasonResponse,
  DraftChatMessageRequest,
  DraftLockPickRequest,
  DraftProvisionalPickRequest,
  FindMatchRequest,
  GetMatchmakingBanStatusResponse,
  GetMatchmakingSeasonsResponse,
  hasVetoes,
  MatchmakingSeasonsServiceErrorCode,
  MatchmakingServiceErrorCode,
  SeasonId,
  ServerAddMatchmakingSeasonRequest,
  toMatchmakingSeasonJson,
} from '../../../common/matchmaking'
import { ALL_RACE_CHARS } from '../../../common/races'
import { makeErrorConverterMiddleware } from '../errors/coded-error'
import { asHttpError } from '../errors/error-with-payload'
import { httpApi, httpBeforeAll } from '../http/http-api'
import { httpBefore, httpDelete, httpGet, httpPost } from '../http/route-decorators'
import { checkAllPermissions } from '../permissions/check-permissions'
import ensureLoggedIn from '../session/ensure-logged-in'
import createThrottle from '../throttle/create-throttle'
import throttleMiddleware from '../throttle/middleware'
import { joiClientIdentifiers } from '../users/client-ids'
import { UserIdentifierManager } from '../users/user-identifier-manager'
import { validateRequest } from '../validation/joi-validator'
import { filterMapSelections } from './map-selections'
import { MatchmakingBanService } from './matchmaking-ban-service'
import { getCurrentMapPool } from './matchmaking-map-pools-models'
import { MatchmakingSeasonsService, MatchmakingSeasonsServiceError } from './matchmaking-seasons'
import { MatchmakingService } from './matchmaking-service'
import { MatchmakingServiceError } from './matchmaking-service-error'
import { matchmakingPreferencesValidator } from './matchmaking-validators'

const matchmakingThrottle = createThrottle('matchmaking', {
  rate: 20,
  burst: 40,
  window: 60000,
})

const draftActionThrottle = createThrottle('matchmaking/draftAction', {
  rate: 40,
  burst: 120,
  window: 60000,
})

const seasonsRetrievalThrottle = createThrottle('seasonsRetrieval', {
  rate: 20,
  burst: 50,
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
    case MatchmakingServiceErrorCode.InvalidDraftPick:
      throw asHttpError(400, err)
    case MatchmakingServiceErrorCode.MatchmakingDisabled:
    case MatchmakingServiceErrorCode.UserBanned:
    case MatchmakingServiceErrorCode.UserChatRestricted:
      throw asHttpError(403, err)
    case MatchmakingServiceErrorCode.NotInQueue:
    case MatchmakingServiceErrorCode.NoActiveDraft:
    case MatchmakingServiceErrorCode.NoActiveMatch:
    case MatchmakingServiceErrorCode.GameplayConflict:
    case MatchmakingServiceErrorCode.MatchAlreadyStarting:
      throw asHttpError(409, err)
    case MatchmakingServiceErrorCode.LoadFailed:
      // This one shouldn't be thrown up to us
      throw asHttpError(500, err)
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
@httpBeforeAll(convertMatchmakingServiceErrors, convertMatchmakingSeasonsServiceErrors)
export class MatchmakingApi {
  constructor(
    private matchmakingService: MatchmakingService,
    private userIdManager: UserIdentifierManager,
    private matchmakingSeasonsService: MatchmakingSeasonsService,
    private matchmakingBanService: MatchmakingBanService,
  ) {}

  @httpPost('/find')
  @httpBefore(
    ensureLoggedIn,
    throttleMiddleware(matchmakingThrottle, ctx => String(ctx.session!.user.id)),
  )
  async findMatch(ctx: RouterContext): Promise<void> {
    const { body } = validateRequest(ctx, {
      body: Joi.object<FindMatchRequest>({
        clientId: Joi.string().required(),
        preferences: matchmakingPreferencesValidator(
          ctx.session!.user.id,
          false /* allowPartial */,
        ).required(),
        identifiers: joiClientIdentifiers(ctx).required(),
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

    await this.userIdManager.upsert(ctx.session!.user.id, identifiers)

    if (await this.userIdManager.banUserIfNeeded(ctx.session!.user.id)) {
      throw new httpErrors.Unauthorized('This account is banned')
    }
    if (await this.matchmakingBanService.checkUser(ctx.session!.user.id)) {
      throw new MatchmakingServiceError(
        MatchmakingServiceErrorCode.UserBanned,
        'This account is currently banned from matchmaking',
      )
    }

    const mapSelections = filterMapSelections(currentMapPool, preferences.mapSelections)
    if (!hasVetoes(preferences.matchmakingType) && !mapSelections.length) {
      throw new MatchmakingServiceError(MatchmakingServiceErrorCode.InvalidMaps, 'No maps selected')
    }

    await this.matchmakingService.find(ctx.session!.user.id, clientId, identifiers, {
      ...preferences,
      mapSelections,
    })
  }

  @httpDelete('/find')
  @httpBefore(
    ensureLoggedIn,
    throttleMiddleware(matchmakingThrottle, ctx => String(ctx.session!.user.id)),
  )
  async cancelSearch(ctx: RouterContext): Promise<void> {
    await this.matchmakingService.cancel(ctx.session!.user.id)
  }

  @httpPost('/accept')
  @httpBefore(
    ensureLoggedIn,
    throttleMiddleware(matchmakingThrottle, ctx => String(ctx.session!.user.id)),
  )
  async acceptMatch(ctx: RouterContext): Promise<void> {
    await this.matchmakingService.accept(ctx.session!.user.id)
  }

  @httpPost('/draft/provisional-pick')
  @httpBefore(
    ensureLoggedIn,
    throttleMiddleware(draftActionThrottle, ctx => String(ctx.session!.user.id)),
  )
  async updateProvisionalRace(ctx: RouterContext): Promise<void> {
    const { body } = validateRequest(ctx, {
      body: Joi.object<DraftProvisionalPickRequest>({
        race: Joi.string()
          .valid(...ALL_RACE_CHARS)
          .required(),
      }),
    })

    await this.matchmakingService.updateProvisionalRace(ctx.session!.user.id, body.race)
  }

  @httpPost('/draft/lock-pick')
  @httpBefore(
    ensureLoggedIn,
    throttleMiddleware(draftActionThrottle, ctx => String(ctx.session!.user.id)),
  )
  async lockInPick(ctx: RouterContext): Promise<void> {
    const { body } = validateRequest(ctx, {
      body: Joi.object<DraftLockPickRequest>({
        race: Joi.string()
          .valid(...ALL_RACE_CHARS)
          .required(),
      }),
    })

    await this.matchmakingService.lockInPick(ctx.session!.user.id, body.race)
  }

  @httpPost('/draft/chat')
  @httpBefore(
    ensureLoggedIn,
    throttleMiddleware(draftActionThrottle, ctx => String(ctx.session!.user.id)),
  )
  async sendDraftChatMessage(ctx: RouterContext): Promise<void> {
    const { body } = validateRequest(ctx, {
      body: Joi.object<DraftChatMessageRequest>({
        message: Joi.string().min(1).required(),
      }),
    })

    await this.matchmakingService.sendDraftChatMessage(ctx.session!.user.id, body.message)
  }

  @httpGet('/ban-status')
  @httpBefore(
    ensureLoggedIn,
    throttleMiddleware(matchmakingThrottle, ctx => String(ctx.session!.user.id)),
  )
  async getBanStatus(ctx: RouterContext): Promise<GetMatchmakingBanStatusResponse> {
    const ban = await this.matchmakingBanService.checkUser(ctx.session!.user.id)
    return {
      bannedUntil: ban ? Number(ban.expiresAt) : undefined,
    }
  }

  @httpGet('/seasons')
  @httpBefore(
    throttleMiddleware(seasonsRetrievalThrottle, ctx => String(ctx.session?.user?.id ?? ctx.ip)),
  )
  async getMatchmakingSeasons(ctx: RouterContext): Promise<GetMatchmakingSeasonsResponse> {
    return {
      seasons: (await this.matchmakingSeasonsService.getAllSeasons()).map(s =>
        toMatchmakingSeasonJson(s),
      ),
      current: (await this.matchmakingSeasonsService.getCurrentSeason()).id,
    }
  }

  @httpPost('/seasons')
  @httpBefore(ensureLoggedIn, checkAllPermissions('manageMatchmakingSeasons'))
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
  @httpBefore(ensureLoggedIn, checkAllPermissions('manageMatchmakingSeasons'))
  async deleteMatchmakingSeason(ctx: RouterContext): Promise<void> {
    const { params } = validateRequest(ctx, {
      params: Joi.object<{ id: SeasonId }>({
        id: Joi.number().min(1).required(),
      }),
    })

    await this.matchmakingSeasonsService.deleteSeason(params.id)
  }
}
