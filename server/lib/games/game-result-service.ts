import { Logger } from 'pino'
import { singleton } from 'tsyringe'
import { assertUnreachable } from '../../../common/assert-unreachable'
import { GameSource } from '../../../common/games/configuration'
import {
  GameRecord,
  GameRecordUpdate,
  GameSubscriptionEvent,
  MatchmakingResultsEvent,
  toGameRecordJson,
} from '../../../common/games/games'
import { GameClientPlayerResult, GameResultErrorCode } from '../../../common/games/results'
import { MatchmakingType, toPublicMatchmakingRatingChangeJson } from '../../../common/matchmaking'
import { RaceChar } from '../../../common/races'
import { urlPath } from '../../../common/urls'
import { SbUserId } from '../../../common/users/sb-user'
import { UserStats } from '../../../common/users/user-stats'
import { UNIQUE_VIOLATION } from '../db/pg-error-codes'
import transact from '../db/transaction'
import { CodedError } from '../errors/coded-error'
import { findUnreconciledGames, setReconciledResult } from '../games/game-models'
import { hasCompletedResults, reconcileResults } from '../games/results'
import { JobScheduler } from '../jobs/job-scheduler'
import logger from '../logging/logger'
import { MatchmakingSeasonsService } from '../matchmaking/matchmaking-seasons'
import {
  getMatchmakingRatingChangesForGame,
  getMatchmakingRatingsWithLock,
  insertMatchmakingRatingChange,
  MatchmakingRating,
  MatchmakingRatingChange,
  updateMatchmakingRating,
} from '../matchmaking/models'
import { calculateChangedRatings } from '../matchmaking/rating'
import {
  getCurrentReportedResults,
  getUserGameRecord,
  setReportedResults,
  setUserReconciledResult,
} from '../models/games-users'
import { Clock } from '../time/clock'
import { incrementUserStatsCount, makeCountKeys } from '../users/user-stats-model'
import { ClientSocketsManager } from '../websockets/socket-groups'
import { TypedPublisher } from '../websockets/typed-publisher'
import { getGameRecord } from './game-models'

export class GameResultServiceError extends CodedError<GameResultErrorCode> {}

/** How often the reconciliation job should run. */
const RECONCILE_INCOMPLETE_RESULTS_MINUTES = 15
/**
 * How long after the first result report until we consider a game to be completed, even if we don't
 * have every players' results.
 * TODO(tec27): Use a more accurate method for detecting games in progress, like pinging the server
 * from the game client periodically, or integrating with rally-point
 */
const FORCE_RECONCILE_TIMEOUT_MINUTES = 3 * 60

@singleton()
export default class GameResultService {
  constructor(
    private clientSocketsManager: ClientSocketsManager,
    private typedPublisher: TypedPublisher<GameSubscriptionEvent>,
    private matchmakingPublisher: TypedPublisher<MatchmakingResultsEvent>,
    private jobScheduler: JobScheduler,
    private matchmakingSeasonsService: MatchmakingSeasonsService,
    private clock: Clock,
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
        // TODO(tec27): add prometheues metric for number of unreconciled games found

        for (const gameId of toReconcile) {
          try {
            const gameRecord = await this.retrieveGame(gameId)
            this.maybeReconcileResults(gameRecord, true /* force */)
          } catch (err: unknown) {
            if (
              err instanceof SyntaxError ||
              err instanceof TypeError ||
              err instanceof ReferenceError ||
              err instanceof RangeError
            ) {
              throw err
            }

            logger.error({ err }, `failed to reconcile game ${gameId}`, err)
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
    userId,
    resultCode,
    time,
    playerResults,
    logger,
  }: {
    gameId: string
    userId: SbUserId
    resultCode: string
    time: number
    playerResults: ReadonlyArray<[playerId: SbUserId, result: GameClientPlayerResult]>
    logger: Logger
  }): Promise<void> {
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

    for (const [id, _] of playerResults) {
      if (!playerIdsInGame.has(id)) {
        throw new GameResultServiceError(
          GameResultErrorCode.InvalidPlayers,
          `player with id ${id} was not found in the game record`,
        )
      }
    }

    await setReportedResults({
      userId,
      gameId,
      reportedResults: {
        time,
        playerResults,
      },
      reportedAt: new Date(this.clock.now()),
    })

    // We don't need to hold up the response while we check for reconciling
    Promise.resolve()
      .then(() => this.maybeReconcileResults(gameRecord))
      .then(async () => {
        const game = await this.retrieveGame(gameId)
        const mmrChanges = await this.retrieveMatchmakingRatingChanges(game)

        const gameJson = toGameRecordJson(game)
        this.typedPublisher.publish(GameResultService.getGameSubPath(gameId), {
          type: 'update',
          game: gameJson,
          mmrChanges: mmrChanges.map(m => toPublicMatchmakingRatingChangeJson(m)),
        })

        if (mmrChanges.length) {
          for (const change of mmrChanges) {
            this.matchmakingPublisher.publish(
              GameResultService.getMatchmakingResultsPath(change.userId),
              {
                userId: change.userId,
                game: gameJson,
                mmrChange: toPublicMatchmakingRatingChangeJson(change),
              },
            )
          }
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

  private async maybeReconcileResults(gameRecord: GameRecord, force = false): Promise<void> {
    const gameId = gameRecord.id
    const currentResults = await getCurrentReportedResults(gameId)
    if (!force && !hasCompletedResults(currentResults)) {
      return
    }

    const reconciled = reconcileResults(currentResults)
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

      const season = await this.matchmakingSeasonsService.getSeasonForDate(gameRecord.startTime)
      const curSeason = await this.matchmakingSeasonsService.getCurrentSeason()

      const matchmakingDbPromises: Array<Promise<unknown>> = []
      if (
        gameRecord.config.gameSource === GameSource.Matchmaking &&
        !reconciled.disputed &&
        // NOTE(tec27): In the case that results are reconciled after a new season has started, we
        // disregard the MMR changes from this game. This does lead to some possible ways to avoid
        // MMR changes through malicious action currently, however the alternative solution is also
        // exploitable (in the opposite direction). Doing it in this way means the rankings we
        // deliver at season end are "final" and never need to be updated again.
        season.id === curSeason.id
      ) {
        // Calculate and update the matchmaking ranks

        // NOTE(tec27): We sort these so we always lock them in the same order and avoid
        // deadlocks
        const userIds = Array.from(reconciled.results.keys()).sort()

        const mmrs = await getMatchmakingRatingsWithLock(
          client,
          userIds,
          gameRecord.config.gameSourceExtra.type,
          season.id,
        )
        if (mmrs.length !== userIds.length) {
          throw new Error('missing MMR for some users')
        }

        const {
          config: { gameSourceExtra },
        } = gameRecord

        let teams: [teamA: SbUserId[], teamB: SbUserId[]]
        if (gameSourceExtra.type === MatchmakingType.Match1v1) {
          teams = [[userIds[0]], [userIds[1]]]
        } else if (gameSourceExtra.type === MatchmakingType.Match2v2) {
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
        })

        for (const mmr of mmrs) {
          const change = ratingChanges.get(mmr.userId)!
          matchmakingDbPromises.push(insertMatchmakingRatingChange(client, change))

          const selectedRace = idToSelectedRace.get(mmr.userId)!
          const assignedRace = reconciled.results.get(mmr.userId)!.race
          const winCount = change.outcome === 'win' ? 1 : 0
          const lossCount = change.outcome === 'win' ? 0 : 1

          const updatedMmr: MatchmakingRating = {
            userId: mmr.userId,
            matchmakingType: mmr.matchmakingType,
            seasonId: mmr.seasonId,
            rating: change.rating,
            uncertainty: change.uncertainty,
            volatility: change.volatility,
            points: change.points,
            pointsConverged: change.pointsConverged,
            bonusUsed: change.bonusUsed,
            numGamesPlayed: mmr.numGamesPlayed + 1,
            lifetimeGames: change.lifetimeGames,
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
            rPLosses: mmr.rPLosses + (selectedRace === 'r' && assignedRace === 'p' ? lossCount : 0),
            rTWins: mmr.rTWins + (selectedRace === 'r' && assignedRace === 't' ? winCount : 0),
            rTLosses: mmr.rTLosses + (selectedRace === 'r' && assignedRace === 't' ? lossCount : 0),
            rZWins: mmr.rZWins + (selectedRace === 'r' && assignedRace === 'z' ? winCount : 0),
            rZLosses: mmr.rZLosses + (selectedRace === 'r' && assignedRace === 'z' ? lossCount : 0),
          }

          matchmakingDbPromises.push(updateMatchmakingRating(client, updatedMmr))
        }
      }
      const userPromises = resultEntries.map(([userId, result]) =>
        setUserReconciledResult(client, userId, gameId, result),
      )

      // TODO(tec27): Perhaps we should auto-trigger a dispute request in particular cases, such
      // as when a user has an unknown result?

      const statsUpdatePromises: Array<Promise<UserStats>> = []
      if (gameRecord.config.gameType !== 'ums' && !reconciled.disputed) {
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

      await Promise.all([
        ...userPromises,
        ...matchmakingDbPromises,
        ...statsUpdatePromises,
        setReconciledResult(client, gameId, reconciled),
      ])
    })
  }

  static getGameSubPath(gameId: string) {
    return urlPath`/games/${gameId}`
  }

  static getMatchmakingResultsPath(userId: SbUserId) {
    return urlPath`/matchmaking-results/${userId}`
  }
}
