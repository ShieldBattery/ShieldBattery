import Joi from 'joi'
import { Logger } from 'pino'
import { singleton } from 'tsyringe'
import { assertUnreachable } from '../../../common/assert-unreachable'
import { GameConfig, GameSource } from '../../../common/games/configuration'
import { GameType } from '../../../common/games/game-type'
import {
  GameRecord,
  GameRecordUpdate,
  GameSubscriptionEvent,
  MatchmakingResultsEvent,
  toGameRecordJson,
} from '../../../common/games/games'
import { computeMatchupString, getTeamsFromConfig } from '../../../common/games/matchups'
import {
  ALL_GAME_CLIENT_ALLIANCE_STATES,
  ALL_GAME_CLIENT_LOSE_TYPES,
  ALL_GAME_CLIENT_RESULTS,
  GameResultErrorCode,
  RawGameResultsReport,
  StoredGameResults,
  SubmitGameResultsRequest,
} from '../../../common/games/results'
import { League, toClientLeagueUserChangeJson, toLeagueJson } from '../../../common/leagues/leagues'
import {
  MATCHMAKING_SEASON_FINALIZED_TIME_MS,
  MatchmakingType,
  toMatchmakingSeasonJson,
  toPublicMatchmakingRatingChangeJson,
} from '../../../common/matchmaking'
import { RaceChar } from '../../../common/races'
import { urlPath } from '../../../common/urls'
import { SbUserId } from '../../../common/users/sb-user-id'
import { UserStats } from '../../../common/users/user-stats'
import { UNIQUE_VIOLATION } from '../db/pg-error-codes'
import transact from '../db/transaction'
import { CodedError } from '../errors/coded-error'
import {
  findFullyReportedUnreconciledGames,
  findKnownCompleteUnreconciledGames,
  findUnreconciledGames,
  findUnreconciledV2GamesForProbe,
  setReconciledResult,
} from '../games/game-models'
import {
  ResultSubmission,
  applyDepartureConcessionTiebreak,
  applyDesyncPolicy,
} from '../games/results'
import { JobScheduler } from '../jobs/job-scheduler'
import { doFullRankingsUpdate, updateRankings } from '../ladder/rankings'
import { updateLeaderboards } from '../leagues/leaderboard'
import {
  LeagueUser,
  LeagueUserChange,
  getActiveLeaguesForUsers,
  getLeagueUserChangesForGame,
  getLeaguesById,
  insertLeagueUserChange,
  updateLeagueUser,
} from '../leagues/league-models'
import logger from '../logging/logger'
import { MatchmakingSeasonsService } from '../matchmaking/matchmaking-seasons'
import {
  MatchmakingRating,
  MatchmakingRatingChange,
  getMatchmakingRatingChangesForGame,
  getMatchmakingRatingsWithLock,
  insertMatchmakingRatingChange,
  updateMatchmakingRating,
} from '../matchmaking/models'
import { calculateChangedRatings } from '../matchmaking/rating'
import { getDesyncEventsForGame } from '../models/game-desync-events'
import {
  areAllHumansAccountedFor,
  getCurrentReportedResults,
  getDepartureTimesForGame,
  getMaxReportedAtForGame,
  getUserGameRecord,
  setReportedResults,
  setUserReconciledResult,
} from '../models/games-users'
import { checkSessionsAlive, loadConfigFromEnv } from '../netcode-v2/netcode-v2-service'
import { Redis } from '../redis/redis'
import { Clock, TimeoutId } from '../time/clock'
import { incrementUserStatsCount, makeCountKeys } from '../users/user-stats-model'
import { joiUserId } from '../users/user-validators'
import { ClientSocketsManager } from '../websockets/socket-groups'
import { TypedPublisher } from '../websockets/typed-publisher'
import { getGameRecord } from './game-models'
import { computeCorroboratedVictors, deriveResultSubmission } from './raw-results'

export class GameResultServiceError extends CodedError<GameResultErrorCode> {}

/**
 * Determines the team groupings used to validate that only one team wins a game, or `null` if no
 * such validation should occur.
 *
 * This is only meaningful when alliances are locked (in-game alliance changes disabled), so the
 * config's starting teams remain authoritative at game end. When alliances aren't locked, players
 * can change alliances mid-game, so two players who started on different teams could legitimately
 * ally and co-win; those games are left to other dispute signals instead.
 *
 * Records created before `lockedAlliances` existed won't have it set, so we fall back to
 * `gameSource === GameSource.Matchmaking` (matchmaking has always locked alliances).
 *
 * If alliances are locked but the config has no determinable teams (a free-for-all melee with
 * more than 2 players), each player is treated as their own team, which still limits the game to a
 * single winner.
 */
export function getValidationTeams(
  config: GameConfig,
  humans: ReadonlyArray<SbUserId>,
): SbUserId[][] | null {
  const alliancesLocked = config.lockedAlliances ?? config.gameSource === GameSource.Matchmaking
  if (!alliancesLocked) {
    return null
  }

  return getTeamsFromConfig(config)?.map(team => team.map(p => p.id)) ?? humans.map(id => [id])
}

/**
 * Whether a game's persisted config recorded a netcode v2 (rally-point2) session. Records created
 * before this field existed, or whose loader never reached the decision, won't have it set, so a
 * missing value falls back to `false` — no v2 session ever existed for them.
 */
export function usedNetcodeV2(config: GameConfig): boolean {
  return config.useNetcodeV2 ?? false
}

/**
 * Whether a game's persisted config marks it exempt from result tracking, because its teams
 * include a computer player (see `registerGame`). Records created before this field existed won't
 * have it set, so a missing value falls back to `false`.
 */
export function isResultsExempt(config: GameConfig): boolean {
  return config.resultsExempt ?? false
}

/** The legacy digested submission shape (no `version`): a set of already-decided per-player verdicts. */
const LEGACY_GAME_RESULTS_REQUEST_SCHEMA = Joi.object<SubmitGameResultsRequest>({
  userId: Joi.number().min(0).required(),
  resultCode: Joi.string().required(),
  time: Joi.number().min(0).required(),
  playerResults: Joi.array()
    .items(
      Joi.array().ordered(
        joiUserId().required(),
        Joi.object({
          result: Joi.valid(...ALL_GAME_CLIENT_RESULTS).required(),
          race: Joi.string().valid('p', 't', 'z').required(),
          apm: Joi.number().min(0).required(),
        }).required(),
      ),
    )
    .min(0)
    .max(8)
    .required(),
}).required()

/** The raw (v2) submission shape: undigested BW evidence the server derives verdicts from. */
const RAW_GAME_RESULTS_REPORT_SCHEMA = Joi.object<RawGameResultsReport>({
  version: Joi.valid(2).required(),
  userId: joiUserId().required(),
  resultCode: Joi.string().required(),
  time: Joi.number().min(0).required(),
  players: Joi.array()
    .items(
      Joi.object({
        userId: joiUserId().allow(null).required(),
        bwPlayerId: Joi.number().integer().min(0).max(7).required(),
        stormId: Joi.number().integer().min(0).max(7).allow(null).required(),
        race: Joi.string().valid('p', 't', 'z').required(),
        victoryState: Joi.valid(...ALL_GAME_CLIENT_RESULTS).required(),
        alliances: Joi.array()
          .length(8)
          .items(Joi.valid(...ALL_GAME_CLIENT_ALLIANCE_STATES))
          .required(),
      }),
    )
    .max(8)
    .required(),
  netPlayers: Joi.array()
    .items(
      Joi.object({
        stormId: Joi.number().integer().min(0).max(7).required(),
        wasDropped: Joi.boolean().required(),
        hasQuit: Joi.boolean().required(),
      }),
    )
    .max(8)
    .required(),
  localPlayerLoseType: Joi.string()
    .valid(...ALL_GAME_CLIENT_LOSE_TYPES)
    .allow(null)
    .required(),
}).required()

/**
 * Validates a game result submission body — used both by the direct `results2` HTTP endpoint and
 * by the netcode-v2 webhook, which decodes a relay-forwarded report and validates it against this
 * same schema before treating it as a submission. Keeping one schema for both entry points means a
 * relay-borne report has to satisfy the exact same shape a directly-POSTed one does.
 *
 * A report is version-discriminated: a `version: 2` body is validated as the raw schema; a body with
 * no `version` is validated as the legacy digested schema (so pre-cutover clients keep working).
 */
export const SUBMIT_GAME_RESULTS_REQUEST_SCHEMA = Joi.alternatives()
  .conditional(Joi.object({ version: Joi.exist() }).unknown(), {
    then: RAW_GAME_RESULTS_REPORT_SCHEMA,
    otherwise: LEGACY_GAME_RESULTS_REQUEST_SCHEMA,
  })
  .required()

/**
 * Whether every required (non-diverged) human has actually submitted a result report, checked by
 * identity rather than count. A diverged player's report is discarded later by the desync policy, so
 * counting it toward the total (e.g. `haveResults >= requiredReporters.length`) would let it satisfy
 * a *different*, non-diverged reporter's requirement — in a >2-human matchmaking game, a diverged
 * client reporting quickly could otherwise push the count up while a real majority reporter is still
 * missing, locking in MMR on a partial majority.
 */
export function haveAllRequiredReportersReported(
  humans: ReadonlyArray<SbUserId>,
  divergedUserIds: ReadonlySet<SbUserId>,
  reportedHumans: ReadonlySet<SbUserId>,
): boolean {
  return humans.filter(id => !divergedUserIds.has(id)).every(id => reportedHumans.has(id))
}

/** How often the reconciliation job should run. */
const RECONCILE_INCOMPLETE_RESULTS_MINUTES = 15
/**
 * How long after the first result report until we consider a game to be completed, even if we don't
 * have every players' results. Only applies to games with no persisted netcode-v2 session id
 * (pre-cutover legacy games, plus the rare v2 game whose session id failed to persist) — a v2 game
 * with a session id is instead covered by the coordinator liveness probe backstop below, which asks
 * rather than blind-forces.
 * TODO(tec27): Use a more accurate method for detecting legacy games in progress, like pinging the
 * server from the game client periodically, or integrating with rally-point
 */
const FORCE_RECONCILE_TIMEOUT_MINUTES = 3 * 60
/**
 * How long after a matchmaking game's last result report we wait for a trailing relay desync verdict
 * before locking in the reconciled result.
 */
const DESYNC_VERDICT_GRACE_MS = 15 * 1000
/** Extra time added to a scheduled grace re-check so the report is comfortably past the window. */
const DESYNC_VERDICT_GRACE_BUFFER_MS = 1000
/**
 * How long a fully-reported game's newest report must be in the past before the sweep reconciles it,
 * ensuring the desync verdict grace window has comfortably elapsed.
 */
const FULLY_REPORTED_RECONCILE_DELAY_MINUTES = 1
/**
 * Backstop for the immediate known-complete force-reconcile (`maybeScheduleKnownCompleteReconcile`):
 * how old a fully-accounted netcode-v2 game's newest report/departure must be before the periodic
 * sweep force-reconciles it too, covering the case where the triggering webhook that would have
 * forced it immediately was itself never delivered or processed (e.g. a server restart).
 */
const RECONCILE_KNOWN_COMPLETE_MINUTES = 10
/**
 * How old an unreconciled netcode-v2 game's `startTime` must be before the periodic sweep includes
 * it in the coordinator liveness probe. Games younger than this are almost certainly still in
 * progress, so there's no reason to ask the coordinator about them yet.
 */
const SESSION_PROBE_MIN_AGE_MINUTES = 30

@singleton()
export default class GameResultService {
  /**
   * Games with a pending one-shot desync-grace re-check, keyed by game ID, so we schedule at most
   * one outstanding re-check per game.
   */
  private readonly desyncGraceRechecks = new Map<string, TimeoutId>()

  constructor(
    private clientSocketsManager: ClientSocketsManager,
    private typedPublisher: TypedPublisher<GameSubscriptionEvent>,
    private matchmakingPublisher: TypedPublisher<MatchmakingResultsEvent>,
    private jobScheduler: JobScheduler,
    private matchmakingSeasonsService: MatchmakingSeasonsService,
    private clock: Clock,
    private redis: Redis,
  ) {
    const jobStartTime = new Date(this.clock.now())
    jobStartTime.setMinutes(jobStartTime.getMinutes() + RECONCILE_INCOMPLETE_RESULTS_MINUTES)

    this.jobScheduler.scheduleJob(
      'lib/games#reconcileIncompleteResults',
      jobStartTime,
      RECONCILE_INCOMPLETE_RESULTS_MINUTES * 60 * 1000,
      async () => {
        const reconcileBefore = new Date(this.clock.now())
        reconcileBefore.setMinutes(reconcileBefore.getMinutes() - FORCE_RECONCILE_TIMEOUT_MINUTES)
        const toReconcile = await findUnreconciledGames(reconcileBefore)
        // TODO(tec27): add prometheus metric for number of unreconciled games found

        for (const gameId of toReconcile) {
          try {
            const gameRecord = await this.retrieveGame(gameId)
            const didReconcile = await this.maybeReconcileResults(gameRecord, true /* force */)
            if (didReconcile) {
              await this.publishReconciledGame(gameId)
            }
          } catch (err: unknown) {
            logger.error({ err }, `failed to reconcile game ${gameId}`)
          }
        }

        // Also reconcile games that are fully reported but never got reconciled (e.g. the server
        // restarted during the desync verdict grace window). These don't need forcing: their grace
        // window has long elapsed, so they reconcile immediately.
        const fullyReportedBefore = new Date(this.clock.now())
        fullyReportedBefore.setMinutes(
          fullyReportedBefore.getMinutes() - FULLY_REPORTED_RECONCILE_DELAY_MINUTES,
        )
        const fullyReported = await findFullyReportedUnreconciledGames(fullyReportedBefore)
        for (const gameId of fullyReported) {
          try {
            const gameRecord = await this.retrieveGame(gameId)
            const didReconcile = await this.maybeReconcileResults(gameRecord, false)
            if (didReconcile) {
              await this.publishReconciledGame(gameId)
            }
          } catch (err: unknown) {
            logger.error({ err }, `failed to reconcile fully-reported game ${gameId}`)
          }
        }

        // Backstop for the event-driven known-complete reconcile below: catches netcode-v2 games
        // whose scheduled one-shot was lost (e.g. a server restart) by forcing any game where every
        // human has reported or departed and the newest such timestamp is well in the past.
        const knownCompleteBefore = new Date(this.clock.now())
        knownCompleteBefore.setMinutes(
          knownCompleteBefore.getMinutes() - RECONCILE_KNOWN_COMPLETE_MINUTES,
        )
        const knownComplete = await findKnownCompleteUnreconciledGames(knownCompleteBefore)
        for (const gameId of knownComplete) {
          try {
            const gameRecord = await this.retrieveGame(gameId)
            const didReconcile = await this.maybeReconcileResults(gameRecord, true /* force */)
            if (didReconcile) {
              await this.publishReconciledGame(gameId)
            }
          } catch (err: unknown) {
            logger.error({ err }, `failed to reconcile known-complete game ${gameId}`)
          }
        }

        // Coordinator liveness probe backstop for netcode-v2 games: rather than blind-forcing on a
        // fixed timeout, ask the coordinator directly whether each unreconciled v2 game's session is
        // still alive, and force-reconcile the ones that are gone/unknown. A v2 game only reaches
        // this backstop if it missed both push paths (the zero-grace known-complete trigger and
        // `sessionClosed`), which is ~zero in steady state, and skips entirely when netcode v2 isn't
        // configured (no v2 games could exist).
        if (loadConfigFromEnv()) {
          const probeBefore = new Date(this.clock.now())
          probeBefore.setMinutes(probeBefore.getMinutes() - SESSION_PROBE_MIN_AGE_MINUTES)
          const probeCandidates = await findUnreconciledV2GamesForProbe(probeBefore)
          if (probeCandidates.length > 0) {
            try {
              const alive = await checkSessionsAlive(probeCandidates.map(c => c.session))
              for (const { gameId, session } of probeCandidates) {
                if (!alive.has(session)) {
                  await this.forceReconcileGame(gameId)
                }
              }
            } catch (err: unknown) {
              logger.error(
                { err },
                'failed to probe coordinator session liveness for sweep backstop',
              )
            }
          }
        }
      },
    )

    this.clientSocketsManager.on('newClient', c => {
      c.subscribe(GameResultService.getMatchmakingResultsPath(c.userId))
    })
  }

  async retrieveGame(gameId: string): Promise<GameRecord> {
    const game = await getGameRecord(gameId)
    if (!game) {
      throw new GameResultServiceError(GameResultErrorCode.NotFound, 'no matching game found')
    }

    return game
  }

  async retrieveMatchmakingRatingChanges(
    gameRecord: Readonly<GameRecord>,
  ): Promise<MatchmakingRatingChange[]> {
    if (gameRecord.config.gameSource !== GameSource.Matchmaking || !gameRecord.results) {
      return []
    }

    return await getMatchmakingRatingChangesForGame(gameRecord.id)
  }

  async retrieveLeagueUserChanges(gameRecord: Readonly<GameRecord>): Promise<LeagueUserChange[]> {
    if (gameRecord.config.gameSource !== GameSource.Matchmaking || !gameRecord.results) {
      return []
    }

    return await getLeagueUserChangesForGame(gameRecord.id)
  }

  async subscribeToGame(userId: SbUserId, clientId: string, gameId: string): Promise<void> {
    const clientSockets = this.clientSocketsManager.getById(userId, clientId)
    if (!clientSockets) {
      throw new GameResultServiceError(
        GameResultErrorCode.InvalidClient,
        'no matching client found, may be offline',
      )
    }

    const game = await this.retrieveGame(gameId)
    if (!game) {
      throw new GameResultServiceError(GameResultErrorCode.NotFound, 'no matching game found')
    }

    clientSockets.subscribe<GameRecordUpdate | undefined>(
      GameResultService.getGameSubPath(gameId),
      async () => {
        const game = await this.retrieveGame(gameId)
        if (game) {
          const mmrChanges = await this.retrieveMatchmakingRatingChanges(game)
          return {
            type: 'update',
            game: toGameRecordJson(game),
            mmrChanges: mmrChanges.map(m => toPublicMatchmakingRatingChangeJson(m)),
          }
        } else {
          return undefined
        }
      },
    )
  }

  async unsubscribeFromGame(userId: SbUserId, clientId: string, gameId: string): Promise<void> {
    const clientSockets = this.clientSocketsManager.getById(userId, clientId)
    if (!clientSockets) {
      throw new GameResultServiceError(
        GameResultErrorCode.InvalidClient,
        'no matching client found, may be offline',
      )
    }

    // NOTE(tec27): We don't check if the game exists because it's theoretically possible to
    // subscribe to a game that then fails to load and has its record deleted, so we don't want to
    // leave clients with orphaned subscriptions that can't be removed. (Possibly we should avoid
    // deleting game records in this case and just mark them as never loaded?)
    clientSockets.unsubscribe(GameResultService.getGameSubPath(gameId))
  }

  async submitGameResults({
    gameId,
    report,
    relayReportTime,
    relayReportFrame,
    logger,
  }: {
    gameId: string
    /** The validated submission body: either a legacy digested report or a raw (v2) report. */
    report: SubmitGameResultsRequest | RawGameResultsReport
    /** When the netcode-v2 relay recorded this report arriving, for reports relayed via webhook. */
    relayReportTime?: Date
    /** The relay's local session frame at arrival, for reports relayed via webhook. */
    relayReportFrame?: number | null
    logger: Logger
  }): Promise<void> {
    const { userId, resultCode, time } = report
    const gameUserRecord = await getUserGameRecord(userId, gameId)
    if (!gameUserRecord || gameUserRecord.resultCode !== resultCode) {
      // TODO(tec27): Should we be giving this info to clients? Should we be giving *more* info?
      throw new GameResultServiceError(GameResultErrorCode.NotFound, 'no matching game found')
    }
    if (gameUserRecord.reportedResults) {
      throw new GameResultServiceError(
        GameResultErrorCode.AlreadyReported,
        'results already reported',
      )
    }

    const gameRecord = (await getGameRecord(gameId))!
    const playerIdsInGame = new Set(
      gameRecord.config.teams.map(team => team.filter(p => !p.isComputer).map(p => p.id)).flat(),
    )

    // Every reported user must be an actual (non-computer) participant of this game. For a raw
    // report the participants are the non-null player user IDs; computers carry a null user id.
    const reportedUserIds =
      'version' in report
        ? report.players.flatMap(p => (p.userId !== null ? [p.userId] : []))
        : report.playerResults.map(([id]) => id)
    for (const id of reportedUserIds) {
      if (!playerIdsInGame.has(id)) {
        throw new GameResultServiceError(
          GameResultErrorCode.InvalidPlayers,
          `player with id ${id} was not found in the game record`,
        )
      }
    }

    const reportedResults: StoredGameResults =
      'version' in report
        ? {
            version: 2,
            time: report.time,
            players: report.players,
            netPlayers: report.netPlayers,
            localPlayerLoseType: report.localPlayerLoseType,
          }
        : { time, playerResults: report.playerResults }

    await setReportedResults({
      userId,
      gameId,
      reportedResults,
      reportedAt: new Date(this.clock.now()),
      relayReportTime,
      relayReportFrame,
    })

    // We don't need to hold up the response while we check for reconciling
    Promise.resolve()
      .then(() => this.maybeReconcileResults(gameRecord))
      .then(async didReconcile => {
        if (didReconcile) {
          await this.publishReconciledGame(gameId)
        }
      })
      .catch(err => {
        if (err.code === UNIQUE_VIOLATION && err.constraint === 'matchmaking_rating_changes_pkey') {
          logger.info({ err }, 'another request already updated rating information')
        } else {
          logger.error(
            { err },
            'checking for and/or updating reconcilable results on submission failed',
          )
        }
      })
  }

  /**
   * Schedules a single one-shot re-check of a game's reconciliation after `delayMs`, used to wait
   * out the desync verdict grace window. Only one re-check is ever outstanding per game.
   */
  private scheduleDesyncGraceRecheck(gameId: string, delayMs: number): void {
    if (this.desyncGraceRechecks.has(gameId)) {
      return
    }

    const timeoutId = this.clock.setTimeout(() => {
      // Cleared unconditionally before doing any async work, so the map entry never outlives this
      // firing regardless of whether the re-check below succeeds, rejects, or the game vanishes
      // (e.g. deleted) in the interim. Nothing after this point can throw synchronously: the rest
      // is a promise chain whose only failure path is the `.catch` below, so an error here can only
      // be logged, never crash the process or wedge the timer bookkeeping.
      this.desyncGraceRechecks.delete(gameId)
      Promise.resolve()
        .then(async () => {
          const gameRecord = await this.retrieveGame(gameId)
          const didReconcile = await this.maybeReconcileResults(gameRecord, false)
          if (didReconcile) {
            await this.publishReconciledGame(gameId)
          }
        })
        .catch(err => {
          logger.error({ err }, `failed to re-check reconciliation for game ${gameId}`)
        })
    }, delayMs)
    this.desyncGraceRechecks.set(gameId, timeoutId)
  }

  /**
   * Checks whether every human in a netcode-v2 game now has either a reported result or a recorded
   * departure, and if so, force-reconciles it immediately. Called after the netcode-v2 webhook
   * ingest records a departure or a result — those are the only two ways a human's slot in such a
   * game closes, so checking after either write is enough to catch the moment the game's input set
   * becomes final.
   *
   * No delivery-skew grace is needed before forcing: a departure notice carries its slot's result
   * inline, so the departure that closes the last open slot already has that slot's result in hand
   * (or definitive proof there never was one) — nothing for this game can still be in flight.
   *
   * No-ops for a non-netcode-v2 game, a results-exempt game (contains computer players — see
   * `isResultsExempt`), a game that's already reconciled, a game that isn't found (it may have been
   * deleted), or one where some human still hasn't reported or departed. Never throws: this only
   * ever runs as a fire-and-forget hook off webhook ingest, so a failure here must not turn an
   * already-successful departure/result write into a failed webhook response.
   */
  async maybeScheduleKnownCompleteReconcile(gameId: string): Promise<void> {
    try {
      const gameRecord = await this.retrieveGame(gameId)
      if (
        gameRecord.results ||
        !usedNetcodeV2(gameRecord.config) ||
        isResultsExempt(gameRecord.config)
      ) {
        return
      }

      if (!(await areAllHumansAccountedFor(gameId))) {
        return
      }
    } catch (err: unknown) {
      if (err instanceof GameResultServiceError && err.code === GameResultErrorCode.NotFound) {
        return
      }
      logger.error(
        { err },
        `failed to check known-complete reconcile eligibility for game ${gameId}`,
      )
      return
    }

    await this.forceReconcileGame(gameId)
  }

  /**
   * Force-reconciles a game immediately and publishes the result if reconciliation actually
   * committed. No-ops for a results-exempt game (contains computer players — see
   * `isResultsExempt`): those never reconcile, regardless of what triggered this call. Never
   * throws — every caller is a fire-and-forget hook off webhook ingest (the zero-grace
   * known-complete trigger above, `sessionClosed` ingest, and the sweep's coordinator liveness
   * probe), so a failure here must not turn an already-successful webhook write into a failed
   * response or interrupt the rest of a sweep.
   */
  async forceReconcileGame(gameId: string): Promise<void> {
    try {
      const gameRecord = await this.retrieveGame(gameId)
      if (isResultsExempt(gameRecord.config)) {
        return
      }

      const didReconcile = await this.maybeReconcileResults(gameRecord, true /* force */)
      if (didReconcile) {
        await this.publishReconciledGame(gameId)
      }
    } catch (err: unknown) {
      logger.error({ err }, `failed to force-reconcile game ${gameId}`)
    }
  }

  /**
   * Reconciles a game's results if they're ready to be reconciled (see the early-return conditions
   * below), persisting the outcome in a transaction.
   *
   * @returns whether a reconciliation was actually committed. `false` covers every path that didn't
   *   touch the DB (results already set, still waiting on a required reporter, or a desync-grace
   *   re-check was scheduled instead) — callers use this to decide whether to publish the updated
   *   game to subscribers, since publishing only makes sense when something actually changed.
   */
  private async maybeReconcileResults(gameRecord: GameRecord, force = false): Promise<boolean> {
    // Defense in depth: every path that could reconcile a results-exempt game (contains computer
    // players — see `isResultsExempt`) is already gated before it gets here — `results2` rejects
    // exempt games outright, webhook ingest never submits reports for them, and both
    // `maybeScheduleKnownCompleteReconcile` and `forceReconcileGame` no-op for them — but this stays
    // as a last-resort guard so no path can ever reconcile one.
    if (gameRecord.results || isResultsExempt(gameRecord.config)) {
      return false
    }

    const gameId = gameRecord.id
    const storedResults = await getCurrentReportedResults(gameId)
    // Raw reports are digested into the same `ResultSubmission` shape a legacy report already has,
    // so everything downstream (reconcile, desync policy, departure tiebreak, persistence) is
    // agnostic to which form a client submitted. `isUms` comes from our own config, never the client.
    const isUms = gameRecord.config.gameType === GameType.UseMapSettings
    // Cross-report evidence for the raw-report veto (Rule A in `deriveResultSubmission`): the set of
    // users whose OWN report claims a self-Victory, computed once over every stored report and fed to
    // each derivation so a leaver's uncorroborated quit-victory in someone else's capture can be
    // stripped while a genuine winner-who-quit's victory is preserved.
    const corroboratedVictors = computeCorroboratedVictors(storedResults)
    const currentResults: Array<ResultSubmission | null> = storedResults.map(stored => {
      if (!stored) {
        return null
      }
      if (stored.kind === 'raw') {
        return deriveResultSubmission(stored.raw, stored.reporter, { isUms, corroboratedVictors })
      }
      return { reporter: stored.reporter, time: stored.time, playerResults: stored.playerResults }
    })
    const humans = gameRecord.config.teams.flatMap(t => t.filter(p => !p.isComputer).map(p => p.id))
    const desyncEvents = await getDesyncEventsForGame(gameId)

    // `divergedUserIds` is coordinator-resolved from a session-create ref and, despite arriving over
    // a signed relay webhook, is treated as untrusted-shaped here: intersect against the game's
    // actual humans so an ID that doesn't belong to this game can never gate reporting or appear in
    // logs as if it did (see the trust-model note on `applyDesyncPolicy` for the full reasoning).
    const humanSet = new Set(humans)
    const divergedUnion = new Set(
      desyncEvents.flatMap(e => e.divergedUserIds).filter(id => humanSet.has(id)),
    )
    const hasNoMajorityEvent = desyncEvents.some(e => e.noMajority)

    // Every human who submitted *any* report, keyed by identity (not count) — a diverged player's
    // report is discarded later by the desync policy, so counting it here would let it satisfy the
    // gate on behalf of a real (non-diverged) reporter who hasn't reported yet.
    const reportedHumans = new Set(
      currentResults.filter((r): r is ResultSubmission => !!r).map(r => r.reporter),
    )
    // A diverged client's simulation can run arbitrarily long, so we never require its report to
    // consider the game fully reported.
    if (!force && !haveAllRequiredReportersReported(humans, divergedUnion, reportedHumans)) {
      return false
    }

    const isMatchmaking = gameRecord.config.gameSource === GameSource.Matchmaking

    // Give a trailing relay desync verdict a brief window to arrive after the final result report
    // before we lock in a matchmaking result. A no-majority event is already terminal (the game
    // voids), so there's nothing left to wait for in that case.
    if (!force && isMatchmaking && !hasNoMajorityEvent) {
      const maxReportedAt = await getMaxReportedAtForGame(gameId)
      if (maxReportedAt) {
        const elapsed = this.clock.now() - maxReportedAt.getTime()
        if (elapsed < DESYNC_VERDICT_GRACE_MS) {
          this.scheduleDesyncGraceRecheck(
            gameId,
            DESYNC_VERDICT_GRACE_MS - elapsed + DESYNC_VERDICT_GRACE_BUFFER_MS,
          )
          return false
        }
      }
    }

    const validationTeams = getValidationTeams(gameRecord.config, humans)
    const { reconciled: policyReconciled, outcome } = applyDesyncPolicy({
      isMatchmaking,
      humans,
      results: currentResults,
      validationTeams,
      desyncEvents,
    })
    let reconciled = policyReconciled

    if (outcome.kind === 'lobby-disputed') {
      logger.info(`game ${gameId} had ${outcome.eventCount} relay desync event(s); forcing dispute`)
    } else if (outcome.kind === 'void') {
      logger.info(
        {
          syncOrdinals: desyncEvents.map(e => e.syncOrdinal),
          noMajority: desyncEvents.map(e => e.noMajority),
          divergedUserIds: Array.from(divergedUnion),
        },
        `game ${gameId} voided by relay desync policy (${outcome.reason})`,
      )
      if (outcome.reason === 'no-majority') {
        // A no-majority desync names no diverged minority, so there's no one to pin the fault on
        // from the event alone — including the case where a player deliberately desyncs their own
        // client to dodge a loss. We can't attribute it automatically, but logging the participants
        // at WARN keeps this reviewable/greppable for manual follow-up. Per-user rate-limiting on
        // repeated self-desync-voids is deferred.
        logger.warn(
          { gameId, participants: humans },
          `netcode-v2 no-majority void; participants=[${humans.join(', ')}] — possible self-desync abuse`,
        )
      }
    } else if (outcome.kind === 'majority-discard') {
      logger.info(
        {
          syncOrdinals: desyncEvents.map(e => e.syncOrdinal),
          divergedUserIds: outcome.divergedUserIds,
        },
        `game ${gameId} reconciled from majority reports after discarding diverged reports`,
      )
    }

    // The departure concession tiebreak only applies when a game has no relay desync events (the
    // desync policy takes precedence). We gate the departure-times query on the cheap prerequisites
    // so we don't hit the DB for games the tiebreak can't apply to anyway.
    if (desyncEvents.length === 0) {
      const hasComputers = gameRecord.config.teams.some(team => team.some(p => p.isComputer))
      const allUnknown = Array.from(reconciled.results.values()).every(r => r.result === 'unknown')
      if ((reconciled.disputed || allUnknown) && !hasComputers && humans.length === 2) {
        const departureTimes = await getDepartureTimesForGame(gameId)
        const tiebreak = applyDepartureConcessionTiebreak({
          reconciled,
          humans,
          hasComputers,
          hasDesyncEvents: false,
          reportedHumans,
          results: currentResults,
          departureTimes,
        })
        if (tiebreak.applied) {
          reconciled = tiebreak.reconciled
          logger.info(
            {
              winner: tiebreak.winner,
              loser: tiebreak.loser,
              loserDepartureTime: departureTimes.get(tiebreak.loser!),
            },
            `departure concession tiebreak applied for game ${gameId}`,
          )
        }
      }
    }

    const reconcileDate = new Date(this.clock.now())
    await transact(async client => {
      // TODO(tec27): in some cases, we'll be re-reconciling results, and we may need to go back
      // and "fixup" rank changes and win/loss counters
      const resultEntries = Array.from(reconciled.results.entries())

      const idToSelectedRace = new Map(
        gameRecord.config.teams
          .map(team =>
            team
              .filter(p => !p.isComputer)
              .map<[id: SbUserId, race: RaceChar]>(p => [p.id, p.race]),
          )
          .flat(),
      )

      const [season, seasonEnd] = await this.matchmakingSeasonsService.getSeasonForDate(
        gameRecord.startTime,
      )

      const matchmakingDbPromises: Array<Promise<unknown>> = []
      const matchmakingRankingChanges: MatchmakingRating[] = []
      const leagueLeaderboardChanges: LeagueUser[] = []
      if (
        gameRecord.config.gameSource === GameSource.Matchmaking &&
        !reconciled.disputed &&
        // Only update matchmaking ratings if we're not past the point that the season is finalized
        (seasonEnd === undefined ||
          Number(seasonEnd) + MATCHMAKING_SEASON_FINALIZED_TIME_MS > Number(reconcileDate))
      ) {
        // Calculate and update the matchmaking ranks

        // NOTE(tec27): We sort these so we always lock them in the same order and avoid
        // deadlocks
        const userIds = Array.from(reconciled.results.keys()).sort()

        const [mmrs, activeLeagues] = await Promise.all([
          getMatchmakingRatingsWithLock(
            client,
            userIds,
            gameRecord.config.gameSourceExtra.type,
            season.id,
          ),
          getActiveLeaguesForUsers(
            userIds,
            gameRecord.config.gameSourceExtra.type,
            gameRecord.startTime,
            client,
          ),
        ])
        if (mmrs.length !== userIds.length) {
          throw new Error('missing MMR for some users')
        }

        const {
          config: { gameSourceExtra },
        } = gameRecord

        let teams: [teamA: SbUserId[], teamB: SbUserId[]]
        if (
          gameSourceExtra.type === MatchmakingType.Match1v1 ||
          gameSourceExtra.type === MatchmakingType.Match1v1Fastest
        ) {
          teams = [[userIds[0]], [userIds[1]]]
        } else if (
          gameSourceExtra.type === MatchmakingType.Match2v2 ||
          gameSourceExtra.type === MatchmakingType.Match2v2Bgh ||
          gameSourceExtra.type === MatchmakingType.Match2v2Hunters ||
          gameSourceExtra.type === MatchmakingType.Match2v2Fastest ||
          gameSourceExtra.type === MatchmakingType.Match3v3Bgh ||
          gameSourceExtra.type === MatchmakingType.Match3v3Hunters ||
          gameSourceExtra.type === MatchmakingType.Match3v3Fastest
        ) {
          // TODO(tec27): Pass gameSourceExtra.parties info to rating change calculation
          teams = gameRecord.config.teams.map(t => t.map(p => p.id)) as [
            teamA: SbUserId[],
            teamB: SbUserId[],
          ]
        } else {
          teams = assertUnreachable(gameSourceExtra)
        }

        const ratingChanges = calculateChangedRatings({
          season,
          gameId,
          gameDate: reconcileDate,
          results: reconciled.results,
          mmrs,
          teams,
          activeLeagues,
        })

        for (const mmr of mmrs) {
          const { matchmaking: matchmakingChange, leagues: leagueChanges } = ratingChanges.get(
            mmr.userId,
          )!
          matchmakingDbPromises.push(insertMatchmakingRatingChange(client, matchmakingChange))

          const selectedRace = idToSelectedRace.get(mmr.userId)!
          const assignedRace = reconciled.results.get(mmr.userId)!.race

          {
            const winCount = matchmakingChange.outcome === 'win' ? 1 : 0
            const lossCount = matchmakingChange.outcome === 'win' ? 0 : 1

            const updatedMmr: MatchmakingRating = {
              userId: mmr.userId,
              matchmakingType: mmr.matchmakingType,
              seasonId: mmr.seasonId,
              rating: matchmakingChange.rating,
              uncertainty: matchmakingChange.uncertainty,
              volatility: matchmakingChange.volatility,
              points: matchmakingChange.points,
              pointsConverged: matchmakingChange.pointsConverged,
              bonusUsed: matchmakingChange.bonusUsed,
              numGamesPlayed: mmr.numGamesPlayed + 1,
              lifetimeGames: matchmakingChange.lifetimeGames,
              lastPlayedDate: reconcileDate,
              wins: mmr.wins + winCount,
              losses: mmr.losses + lossCount,

              pWins: mmr.pWins + (selectedRace === 'p' ? winCount : 0),
              pLosses: mmr.pLosses + (selectedRace === 'p' ? lossCount : 0),
              tWins: mmr.tWins + (selectedRace === 't' ? winCount : 0),
              tLosses: mmr.tLosses + (selectedRace === 't' ? lossCount : 0),
              zWins: mmr.zWins + (selectedRace === 'z' ? winCount : 0),
              zLosses: mmr.zLosses + (selectedRace === 'z' ? lossCount : 0),
              rWins: mmr.rWins + (selectedRace === 'r' ? winCount : 0),
              rLosses: mmr.rLosses + (selectedRace === 'r' ? lossCount : 0),

              rPWins: mmr.rPWins + (selectedRace === 'r' && assignedRace === 'p' ? winCount : 0),
              rPLosses:
                mmr.rPLosses + (selectedRace === 'r' && assignedRace === 'p' ? lossCount : 0),
              rTWins: mmr.rTWins + (selectedRace === 'r' && assignedRace === 't' ? winCount : 0),
              rTLosses:
                mmr.rTLosses + (selectedRace === 'r' && assignedRace === 't' ? lossCount : 0),
              rZWins: mmr.rZWins + (selectedRace === 'r' && assignedRace === 'z' ? winCount : 0),
              rZLosses:
                mmr.rZLosses + (selectedRace === 'r' && assignedRace === 'z' ? lossCount : 0),
            }

            matchmakingDbPromises.push(updateMatchmakingRating(client, updatedMmr))
            matchmakingRankingChanges.push(updatedMmr)
          }

          for (const leagueChange of leagueChanges) {
            const oldLeagueUser = activeLeagues
              .get(leagueChange.userId)!
              .find(l => l.leagueId === leagueChange.leagueId)!

            if (oldLeagueUser.isBanned) {
              // Don't process league changes for banned users
              continue
            }

            matchmakingDbPromises.push(insertLeagueUserChange(leagueChange, client))

            const winCount = leagueChange.outcome === 'win' ? 1 : 0
            const lossCount = leagueChange.outcome === 'win' ? 0 : 1

            const updatedLeagueUser: LeagueUser = {
              leagueId: oldLeagueUser.leagueId,
              userId: oldLeagueUser.userId,
              isBanned: oldLeagueUser.isBanned,
              lastPlayedDate: reconcileDate,
              points: leagueChange.points,
              pointsConverged: leagueChange.pointsConverged,
              wins: oldLeagueUser.wins + winCount,
              losses: oldLeagueUser.losses + lossCount,

              pWins: oldLeagueUser.pWins + (selectedRace === 'p' ? winCount : 0),
              pLosses: oldLeagueUser.pLosses + (selectedRace === 'p' ? lossCount : 0),
              tWins: oldLeagueUser.tWins + (selectedRace === 't' ? winCount : 0),
              tLosses: oldLeagueUser.tLosses + (selectedRace === 't' ? lossCount : 0),
              zWins: oldLeagueUser.zWins + (selectedRace === 'z' ? winCount : 0),
              zLosses: oldLeagueUser.zLosses + (selectedRace === 'z' ? lossCount : 0),
              rWins: oldLeagueUser.rWins + (selectedRace === 'r' ? winCount : 0),
              rLosses: oldLeagueUser.rLosses + (selectedRace === 'r' ? lossCount : 0),

              rPWins:
                oldLeagueUser.rPWins +
                (selectedRace === 'r' && assignedRace === 'p' ? winCount : 0),
              rPLosses:
                oldLeagueUser.rPLosses +
                (selectedRace === 'r' && assignedRace === 'p' ? lossCount : 0),
              rTWins:
                oldLeagueUser.rTWins +
                (selectedRace === 'r' && assignedRace === 't' ? winCount : 0),
              rTLosses:
                oldLeagueUser.rTLosses +
                (selectedRace === 'r' && assignedRace === 't' ? lossCount : 0),
              rZWins:
                oldLeagueUser.rZWins +
                (selectedRace === 'r' && assignedRace === 'z' ? winCount : 0),
              rZLosses:
                oldLeagueUser.rZLosses +
                (selectedRace === 'r' && assignedRace === 'z' ? lossCount : 0),
            }

            matchmakingDbPromises.push(updateLeagueUser(updatedLeagueUser, client))
            leagueLeaderboardChanges.push(updatedLeagueUser)
          }
        }
      }
      const userPromises = resultEntries.map(([userId, result]) =>
        setUserReconciledResult(client, userId, gameId, result),
      )

      // TODO(tec27): Perhaps we should auto-trigger a dispute request in particular cases, such
      // as when a user has an unknown result?

      const statsUpdatePromises: Array<Promise<UserStats>> = []
      if (gameRecord.config.gameType !== GameType.UseMapSettings && !reconciled.disputed) {
        for (const [userId, result] of reconciled.results.entries()) {
          if (result.result !== 'win' && result.result !== 'loss') {
            continue
          }

          const selectedRace = idToSelectedRace.get(userId)!
          const assignedRace = result.race
          const countKeys = makeCountKeys(selectedRace, assignedRace, result.result)

          for (const key of countKeys) {
            statsUpdatePromises.push(incrementUserStatsCount(client, userId, key))
          }
        }
      }

      // Only compute an assigned matchup when we actually know every player's assigned race: skip
      // games with computers (which are excluded from results) and disputed games. A disputed game
      // can have a player who's missing from every report, in which case reconcileResults falls back
      // to a fabricated 'p' race (see results.ts) that we don't want to bake into the matchup. This
      // also keeps us consistent with the backfill, which leaves assigned_matchup NULL in these
      // cases.
      const hasComputers = gameRecord.config.teams.some(team => team.some(p => p.isComputer))
      const teams =
        !hasComputers && !reconciled.disputed ? getTeamsFromConfig(gameRecord.config) : null
      const assignedMatchup = teams
        ? computeMatchupString(teams.map(team => team.map(p => reconciled.results.get(p.id)!.race)))
        : null

      await Promise.all([
        ...userPromises,
        ...matchmakingDbPromises,
        ...statsUpdatePromises,
        setReconciledResult(client, gameId, reconciled, assignedMatchup),
      ])

      if (matchmakingRankingChanges.length) {
        // NOTE(tec27): This is a best-effort thing, as these leaderboards are basically just a
        // cache and can be regenerated from the data at any time. We don't want to update them
        // unless the DB queries succeed, but the DB queries succeeding and this failing is "okay"
        // as far as accepting the game results
        updateRankings(this.redis, matchmakingRankingChanges).catch(err => {
          logger.error({ err }, 'Error updating rankings, triggering full update')
          // TODO(tec27): Should probably debounce this update in some way in case we get a ton of
          // errors in a row for some reason
          doFullRankingsUpdate(
            this.redis,
            matchmakingRankingChanges[0].matchmakingType,
            season.id,
          ).catch(err => {
            logger.error({ err }, 'Error doing full rankings update')
          })
        })
      }
      if (leagueLeaderboardChanges.length) {
        // NOTE(tec27): This is a best-effort thing, as these leaderboards are basically just a
        // cache and can be regenerated from the data at any time. We don't want to update them
        // unless the DB queries succeed, but the DB queries succeeding and this failing is "okay"
        // as far as accepting the game results
        updateLeaderboards(this.redis, leagueLeaderboardChanges).catch(err => {
          logger.error({ err }, 'Error updating league leaderboards')
          // TODO(tec27): If this fails, the leaderboards should be queued for regeneration at some
          // point in the (near) future
        })
      }
    })

    return true
  }

  /**
   * Publishes a game's current record — and, if applicable, matchmaking rating/league changes — to
   * subscribers: the game's own subscription channel gets an `update` event, and each user whose MMR
   * changed gets a personal matchmaking-results event. Every entry point that can commit a
   * reconciliation (an immediate submit-triggered reconcile, the delayed desync-grace re-check, the
   * known-complete force-reconcile, and the periodic sweeps) calls this afterward, so a
   * late/asynchronous reconcile still reaches clients instead of leaving them on a stale game/MMR
   * until a manual refetch.
   */
  private async publishReconciledGame(gameId: string): Promise<void> {
    const game = await this.retrieveGame(gameId)
    const [mmrChanges, leagueUserChanges, season] = await Promise.all([
      this.retrieveMatchmakingRatingChanges(game),
      this.retrieveLeagueUserChanges(game),
      this.matchmakingSeasonsService.getSeasonForDate(game.startTime).then(([s]) => s),
    ])

    let leagues: League[] = []
    if (leagueUserChanges.length > 0) {
      const uniqueLeagues = Array.from(new Set(leagueUserChanges.map(lu => lu.leagueId)))
      leagues = await getLeaguesById(uniqueLeagues)
    }

    const gameJson = toGameRecordJson(game)
    this.typedPublisher.publish(GameResultService.getGameSubPath(gameId), {
      type: 'update',
      game: gameJson,
      mmrChanges: mmrChanges.map(m => toPublicMatchmakingRatingChangeJson(m)),
    })

    if (mmrChanges.length) {
      for (const change of mmrChanges) {
        const leagueChanges = leagueUserChanges.filter(lu => lu.userId === change.userId)
        const leagueIds = leagueChanges.map(lu => lu.leagueId)
        const applicableLeagues = leagues.filter(l => leagueIds.includes(l.id))

        this.matchmakingPublisher.publish(
          GameResultService.getMatchmakingResultsPath(change.userId),
          {
            userId: change.userId,
            game: gameJson,
            mmrChange: toPublicMatchmakingRatingChangeJson(change),
            leagues: applicableLeagues.map(l => toLeagueJson(l)),
            leagueChanges: leagueChanges.map(lu => toClientLeagueUserChangeJson(lu)),
            season: toMatchmakingSeasonJson(season),
          },
        )
      }
    }
  }

  static getGameSubPath(gameId: string) {
    return urlPath`/games/${gameId}`
  }

  static getMatchmakingResultsPath(userId: SbUserId) {
    return urlPath`/matchmaking-results/${userId}`
  }
}
