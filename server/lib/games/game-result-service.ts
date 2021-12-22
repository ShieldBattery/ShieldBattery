import { Logger } from 'pino'
import { singleton } from 'tsyringe'
import { assertUnreachable } from '../../../common/assert-unreachable'
import { GameSource } from '../../../common/games/configuration'
import {
  GameRecord,
  GameRecordUpdate,
  GameSubscriptionEvent,
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
import { setReconciledResult } from '../games/game-models'
import { hasCompletedResults, reconcileResults } from '../games/results'
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
import { findUsersByName } from '../users/user-model'
import { incrementUserStatsCount, makeCountKeys } from '../users/user-stats-model'
import { ClientSocketsManager } from '../websockets/socket-groups'
import { TypedPublisher } from '../websockets/typed-publisher'
import { getGameRecord } from './game-models'

export class GameResultServiceError extends CodedError<GameResultErrorCode> {}

@singleton()
export default class GameResultService {
  constructor(
    readonly clientSocketsManager: ClientSocketsManager,
    readonly typedPublisher: TypedPublisher<GameSubscriptionEvent>,
  ) {}

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
    playerResults: ReadonlyArray<[playerName: string, result: GameClientPlayerResult]>
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

    const namesInResults = playerResults.map(r => r[0])
    const namesToUsers = await findUsersByName(namesInResults)

    const gameRecord = (await getGameRecord(gameId))!
    const playerIdsInGame = new Set(
      gameRecord.config.teams.map(team => team.filter(p => !p.isComputer).map(p => p.id)).flat(),
    )

    for (const [name, user] of namesToUsers.entries()) {
      if (!playerIdsInGame.has(user.id)) {
        throw new GameResultServiceError(
          GameResultErrorCode.InvalidPlayers,
          `player '${name}' was not found in the game record`,
        )
      }
    }

    const idResults: [number, GameClientPlayerResult][] = playerResults.map(([name, result]) => [
      namesToUsers.get(name)!.id,
      result,
    ])

    await setReportedResults({
      userId,
      gameId,
      reportedResults: {
        time,
        playerResults: idResults,
      },
      reportedAt: new Date(),
    })

    // We don't need to hold up the response while we check for reconciling
    Promise.resolve()
      .then(() => this.maybeReconcileResults(gameRecord))
      .then(async () => {
        const game = await this.retrieveGame(gameId)
        const mmrChanges = await this.retrieveMatchmakingRatingChanges(game)
        this.typedPublisher.publish(GameResultService.getGameSubPath(gameId), {
          type: 'update',
          game: toGameRecordJson(game),
          mmrChanges: mmrChanges.map(m => toPublicMatchmakingRatingChangeJson(m)),
        })
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

  // TODO(tec27): Periodically check for games that have not been reconciled that are older than X
  // time, and force a result (or mark them permanently unknown/unfinished)
  private async maybeReconcileResults(gameRecord: GameRecord): Promise<void> {
    const gameId = gameRecord.id
    const currentResults = await getCurrentReportedResults(gameId)
    if (!hasCompletedResults(currentResults)) {
      return
    }

    const reconciled = reconcileResults(currentResults)
    const reconcileDate = new Date()
    await transact(async client => {
      // TODO(tec27): in some cases, we'll be re-reconciling results, and we may need to go back
      // and "fixup" rank changes and win/loss counters
      const resultEntries = Array.from(reconciled.results.entries())

      const matchmakingDbPromises: Array<Promise<unknown>> = []
      if (gameRecord.config.gameSource === GameSource.Matchmaking && !reconciled.disputed) {
        // Calculate and update the matchmaking ranks

        // NOTE(tec27): We sort these so we always lock them in the same order and avoid
        // deadlocks
        const userIds = Array.from(reconciled.results.keys()).sort()

        const mmrs = await getMatchmakingRatingsWithLock(
          client,
          userIds,
          gameRecord.config.gameSourceExtra.type,
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
          gameId,
          gameDate: reconcileDate,
          results: reconciled.results,
          mmrs,
          teams,
        })

        for (const mmr of mmrs) {
          const change = ratingChanges.get(mmr.userId)!
          matchmakingDbPromises.push(insertMatchmakingRatingChange(client, change))

          const updatedMmr: MatchmakingRating = {
            userId: mmr.userId,
            matchmakingType: mmr.matchmakingType,
            rating: change.rating,
            kFactor: change.kFactor,
            uncertainty: change.uncertainty,
            unexpectedStreak: change.unexpectedStreak,
            numGamesPlayed: mmr.numGamesPlayed + 1,
            lastPlayedDate: reconcileDate,
            wins: mmr.wins + (change.outcome === 'win' ? 1 : 0),
            losses: mmr.losses + (change.outcome === 'win' ? 0 : 1),
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
        const idToSelectedRace = new Map(
          gameRecord.config.teams
            .map(team =>
              team
                .filter(p => !p.isComputer)
                .map<[id: number, race: RaceChar]>(p => [p.id, p.race]),
            )
            .flat(),
        )

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
}
