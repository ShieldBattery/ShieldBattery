import { Logger } from 'pino'
import { singleton } from 'tsyringe'
import { assertUnreachable } from '../../../common/assert-unreachable.js'
import { GameSource, GameType } from '../../../common/games/configuration.js'
import {
  GameRecord,
  GameRecordUpdate,
  GameSubscriptionEvent,
  MatchmakingResultsEvent,
  toGameRecordJson,
} from '../../../common/games/games.js'
import { GameClientPlayerResult, GameResultErrorCode } from '../../../common/games/results.js'
import {
  League,
  toClientLeagueUserChangeJson,
  toLeagueJson,
} from '../../../common/leagues/index.js'
import {
  MatchmakingType,
  toPublicMatchmakingRatingChangeJson,
} from '../../../common/matchmaking.js'
import { RaceChar } from '../../../common/races.js'
import { urlPath } from '../../../common/urls.js'
import { SbUserId } from '../../../common/users/sb-user.js'
import { UserStats } from '../../../common/users/user-stats.js'
import { UNIQUE_VIOLATION } from '../db/pg-error-codes.js'
import transact from '../db/transaction.js'
import { CodedError } from '../errors/coded-error.js'
import { findUnreconciledGames, setReconciledResult } from '../games/game-models.js'
import { reconcileResults } from '../games/results.js'
import { JobScheduler } from '../jobs/job-scheduler.js'
import { updateLeaderboards } from '../leagues/leaderboard.js'
import {
  LeagueUser,
  LeagueUserChange,
  getActiveLeaguesForUsers,
  getLeagueUserChangesForGame,
  getLeaguesById,
  insertLeagueUserChange,
  updateLeagueUser,
} from '../leagues/league-models.js'
import logger from '../logging/logger.js'
import { MatchmakingSeasonsService } from '../matchmaking/matchmaking-seasons.js'
import {
  MatchmakingRating,
  MatchmakingRatingChange,
  getMatchmakingRatingChangesForGame,
  getMatchmakingRatingsWithLock,
  insertMatchmakingRatingChange,
  updateMatchmakingRating,
} from '../matchmaking/models.js'
import { calculateChangedRatings } from '../matchmaking/rating.js'
import {
  getCurrentReportedResults,
  getUserGameRecord,
  setReportedResults,
  setUserReconciledResult,
} from '../models/games-users.js'
import { Redis } from '../redis/redis.js'
import { Clock } from '../time/clock.js'
import { incrementUserStatsCount, makeCountKeys } from '../users/user-stats-model.js'
import { ClientSocketsManager } from '../websockets/socket-groups.js'
import { TypedPublisher } from '../websockets/typed-publisher.js'
import { getGameRecord } from './game-models.js'

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
            await this.maybeReconcileResults(gameRecord, true /* force */)
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
        const [mmrChanges, leagueUserChanges] = await Promise.all([
          this.retrieveMatchmakingRatingChanges(game),
          this.retrieveLeagueUserChanges(game),
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
    if (gameRecord.results) {
      return
    }

    const gameId = gameRecord.id
    const currentResults = await getCurrentReportedResults(gameId)
    const numHumans = gameRecord.config.teams.flatMap(t => t.filter(p => !p.isComputer)).length
    const haveResults = currentResults.filter(r => !!r).length
    if (!force && haveResults < numHumans) {
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
      const leagueLeaderboardChanges: LeagueUser[] = []
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
          }

          for (const leagueChange of leagueChanges) {
            matchmakingDbPromises.push(insertLeagueUserChange(leagueChange, client))

            const winCount = leagueChange.outcome === 'win' ? 1 : 0
            const lossCount = leagueChange.outcome === 'win' ? 0 : 1
            const oldLeagueUser = activeLeagues
              .get(leagueChange.userId)!
              .find(l => l.leagueId === leagueChange.leagueId)!

            const updatedLeagueUser: LeagueUser = {
              leagueId: oldLeagueUser.leagueId,
              userId: oldLeagueUser.userId,
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

      await Promise.all([
        ...userPromises,
        ...matchmakingDbPromises,
        ...statsUpdatePromises,
        setReconciledResult(client, gameId, reconciled),
      ])

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
  }

  static getGameSubPath(gameId: string) {
    return urlPath`/games/${gameId}`
  }

  static getMatchmakingResultsPath(userId: SbUserId) {
    return urlPath`/matchmaking-results/${userId}`
  }
}
