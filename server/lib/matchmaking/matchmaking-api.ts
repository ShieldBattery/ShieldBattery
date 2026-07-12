import { RouterContext } from '@koa/router'
import httpErrors from 'http-errors'
import Joi from 'joi'
import { assertUnreachable } from '../../../common/assert-unreachable'
import {
  AddMatchmakingSeasonResponse,
  ALL_MATCHMAKING_TYPES,
  DraftChatMessageRequest,
  DraftLockPickRequest,
  DraftProvisionalPickRequest,
  FindMatchRequest,
  GetMatchmakingBanStatusResponse,
  getMatchmakingModeInfo,
  GetMatchmakingSeasonsResponse,
  MatchmakingSeasonsServiceErrorCode,
  MatchmakingServiceErrorCode,
  SeasonId,
  ServerAddMatchmakingSeasonRequest,
  toMatchmakingSeasonJson,
} from '../../../common/matchmaking'
import { ALL_RACE_CHARS } from '../../../common/races'
import { RestrictionKind } from '../../../common/users/restrictions'
import { withDbClient } from '../db'
import transact from '../db/transaction'
import { makeErrorConverterMiddleware } from '../errors/coded-error'
import { asHttpError } from '../errors/error-with-payload'
import { httpApi, httpBeforeAll } from '../http/http-api'
import { httpBefore, httpDelete, httpGet, httpPost } from '../http/route-decorators'
import logger from '../logging/logger'
import { checkAllPermissions } from '../permissions/check-permissions'
import ensureLoggedIn from '../session/ensure-logged-in'
import createThrottle from '../throttle/create-throttle'
import throttleMiddleware from '../throttle/middleware'
import { joiClientIdentifiers } from '../users/client-ids'
import { RestrictionService } from '../users/restriction-service'
import { UserIdentifierManager } from '../users/user-identifier-manager'
import { validateRequest } from '../validation/joi-validator'
import { filterMapSelections } from './map-selections'
import { MatchmakingBanService } from './matchmaking-ban-service'
import { getCurrentMapPool } from './matchmaking-map-pools-models'
import MatchmakingPreferencesService from './matchmaking-preferences-service'
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
    private matchmakingPreferencesService: MatchmakingPreferencesService,
    private restrictionService: RestrictionService,
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
        preferences: Joi.array()
          .items(matchmakingPreferencesValidator(ctx.session!.user.id, false /* allowPartial */))
          .min(1)
          .max(ALL_MATCHMAKING_TYPES.length)
          .unique((a, b) => a.matchmakingType === b.matchmakingType)
          .required(),
        identifiers: joiClientIdentifiers(ctx).required(),
        // The desired region is optional and only loosely validated here (it's an opaque id): the
        // service checks it against the live region list at queue time and drops it if unknown, so a
        // client with no measured regions can queue region-less. `rttMs` is only meaningful with a
        // region and is required alongside one.
        region: Joi.string().max(64),
        rttMs: Joi.number().min(0).when('region', {
          is: Joi.exist(),
          then: Joi.required(),
          otherwise: Joi.forbidden(),
        }),
      }),
    })
    const { clientId, preferences, identifiers, region, rttMs } = body

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
    // A manual matchmaking restriction (for intentional leaving/griefing) blocks queueing too. It
    // surfaces through the same UserBanned path as the automatic dodge-ban so the client shows the
    // familiar banned dialog (with a countdown driven by /ban-status).
    if (
      await this.restrictionService.isRestricted(ctx.session!.user.id, RestrictionKind.Matchmaking)
    ) {
      throw new MatchmakingServiceError(
        MatchmakingServiceErrorCode.UserBanned,
        'This account is currently banned from matchmaking',
      )
    }

    // Validate and normalize each type's preferences against its current map pool. We do this on a
    // single shared connection rather than fanning out one query per type, which could grab more
    // pool connections than we have and starve other work.
    const processedPreferences = await withDbClient(async client => {
      const processed: typeof preferences = []
      for (const pref of preferences) {
        const currentMapPool = await getCurrentMapPool(pref.matchmakingType, client)
        if (!currentMapPool) {
          throw new MatchmakingServiceError(
            MatchmakingServiceErrorCode.InvalidMapPool,
            "Map pool doesn't exist",
          )
        }

        const mapSelections = filterMapSelections(currentMapPool, pref.mapSelections)
        // Only positive-pick modes require an explicit selection. Veto modes default to the whole
        // pool when nothing is vetoed, and fixed modes ignore player selections entirely (the map is
        // chosen automatically), so neither should be rejected for an empty selection.
        if (
          getMatchmakingModeInfo(pref.matchmakingType).mapSelectionStyle === 'pick' &&
          !mapSelections.length
        ) {
          throw new MatchmakingServiceError(
            MatchmakingServiceErrorCode.InvalidMaps,
            'No maps selected',
          )
        }

        processed.push({ ...pref, mapSelections })
      }
      return processed
    })

    await this.matchmakingService.find(
      ctx.session!.user.id,
      clientId,
      identifiers,
      processedPreferences,
      { region, rttMs },
    )

    // Persist the preferences used for this search so they're pre-filled next session and usable for
    // "search again" without the user having to open the settings drawer first. We store what the
    // client sent (preserving their `mapPoolId`) rather than the pool-filtered version, so the
    // "pool updated" indicator keeps working for users who queue without reviewing a new pool. A
    // failure here shouldn't fail an already-successful queue.
    try {
      await transact(async client => {
        // A single bulk upsert (rather than one query per type) so a many-type queue doesn't grab a
        // pool connection per type.
        await this.matchmakingPreferencesService.upsertManyPreferences(preferences, client)
        // Remember which modes were queued (clearing the rest) so the find-match page can restore
        // this selection next session and across devices without the user re-checking each mode.
        // Runs after the upserts so the queued types' rows are guaranteed to exist.
        await this.matchmakingPreferencesService.setSelectedTypes(
          ctx.session!.user.id,
          preferences.map(pref => pref.matchmakingType),
          client,
        )
      })
    } catch (err) {
      logger.error({ err }, 'error saving matchmaking preferences after queueing')
    }
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
    // Report the latest end time across both the automatic dodge-ban and any manual matchmaking
    // restriction, so the banned dialog counts down to whichever keeps the user out longer.
    const [ban, restrictionEndTime] = await Promise.all([
      this.matchmakingBanService.checkUser(ctx.session!.user.id),
      this.restrictionService.getActiveRestrictionEndTime(
        ctx.session!.user.id,
        RestrictionKind.Matchmaking,
      ),
    ])

    const banExpiresAt = ban ? Number(ban.expiresAt) : undefined
    const endTimes = [banExpiresAt, restrictionEndTime].filter((t): t is number => t !== undefined)
    return {
      bannedUntil: endTimes.length ? Math.max(...endTimes) : undefined,
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
