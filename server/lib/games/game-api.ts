import { RouterContext } from '@koa/router'
import httpErrors from 'http-errors'
import Joi from 'joi'
import { Readable } from 'stream'
import { container, singleton } from 'tsyringe'
import { GameStatus } from '../../../common/game-status'
import { GameSource } from '../../../common/games/configuration'
import { GetGamePayload, toGameRecordJson } from '../../../common/games/games'
import { GameClientPlayerResult, GameClientResult } from '../../../common/games/results'
import { toMapInfoJson } from '../../../common/maps'
import { RaceChar } from '../../../common/races'
import { SbUserId } from '../../../common/users/user-info'
import { UserStats } from '../../../common/users/user-stats'
import { UNIQUE_VIOLATION } from '../db/pg-error-codes'
import transact from '../db/transaction'
import { setReconciledResult } from '../games/game-models'
import { hasCompletedResults, reconcileResults } from '../games/results'
import { httpApi } from '../http/http-api'
import { httpBefore, httpGet, httpPost, httpPut } from '../http/route-decorators'
import logger from '../logging/logger'
import { getMapInfo } from '../maps/map-models'
import {
  getMatchmakingRatingsWithLock,
  insertMatchmakingRatingChange,
  MatchmakingRating,
  updateMatchmakingRating,
} from '../matchmaking/models'
import { calculateChangedRatings } from '../matchmaking/rating'
import {
  getCurrentReportedResults,
  getUserGameRecord,
  setReportedResults,
  setUserReconciledResult,
} from '../models/games-users'
import ensureLoggedIn from '../session/ensure-logged-in'
import createThrottle from '../throttle/create-throttle'
import throttleMiddleware from '../throttle/middleware'
import { findUsersById, findUsersByName } from '../users/user-model'
import { incrementUserStatsCount, makeCountKeys } from '../users/user-stats-model'
import { validateRequest } from '../validation/joi-validator'
import gameLoader from './game-loader'
import { countCompletedGames, getGameRecord } from './game-models'

const throttle = createThrottle('games', {
  rate: 20,
  burst: 40,
  window: 60000,
})

const gameResultsThrottle = createThrottle('gamesResults', {
  rate: 10,
  burst: 30,
  window: 60000,
})

const GAME_ID_PARAM = Joi.object<{ gameId: string }>({
  gameId: Joi.string().required(),
})

// TODO(tec27): This should be put somewhere common so the client code can use the same interface
// when making the request
interface SubmitGameResultsBody {
  /** The ID of the user submitting results. */
  userId: SbUserId
  /** The secret code the user was given to submit results with. */
  resultCode: string
  /** The elapsed time of the game, in milliseconds. */
  time: number
  /** A tuple of (player name, result). */
  playerResults: [string, GameClientPlayerResult][]
}

@singleton()
class GameCountEmitter {
  static readonly GAME_COUNT_UPDATE_TIME_MS = 30 * 1000

  streams = new Set<Readable>()
  interval: ReturnType<typeof setInterval> | undefined
  lastCount = 0

  addListener(stream: Readable) {
    stream.push(`event: gameCount\ndata: ${this.lastCount}\n\n`)
    this.streams.add(stream)
    this.start()
  }

  removeListener(stream: Readable) {
    this.streams.delete(stream)
    if (this.streams.size === 0) {
      this.stop()
    }
  }

  private start() {
    if (this.interval) {
      return
    }

    const doCount = () => {
      countCompletedGames()
        .then(count => {
          this.lastCount = count
          const message = `event: gameCount\ndata: ${this.lastCount}\n\n`
          for (const stream of this.streams.values()) {
            stream.push(message)
          }
        })
        .catch(err => {
          logger.error({ err }, 'error retrieving/sending completed game count')
        })
    }

    doCount()
    this.interval = setInterval(doCount, GameCountEmitter.GAME_COUNT_UPDATE_TIME_MS)
  }

  private stop() {
    if (this.interval) {
      clearInterval(this.interval)
      this.interval = undefined
    }
  }
}

@httpApi('/games')
export class GameApi {
  @httpGet('/:gameId')
  @httpBefore(ensureLoggedIn, throttleMiddleware(throttle, ctx => String(ctx.session!.userId)))
  async getGame(ctx: RouterContext): Promise<GetGamePayload> {
    const {
      params: { gameId },
    } = validateRequest(ctx, {
      params: GAME_ID_PARAM,
    })

    const game = await getGameRecord(gameId)
    if (!game) {
      throw new httpErrors.NotFound('game not found')
    }

    const mapPromise = getMapInfo([game.mapId], ctx.session!.userId)
    const usersPromise = findUsersById(
      game.config.teams.flatMap(t => t.filter(p => !p.isComputer).map(p => p.id)),
    )

    const mapArray = await mapPromise
    if (!mapArray.length) {
      throw new Error("map wasn't found")
    }

    return {
      game: toGameRecordJson(game),
      map: toMapInfoJson(mapArray[0]),
      users: Array.from((await usersPromise).values()),
    }
  }

  @httpPut('/:gameId/status')
  @httpBefore(ensureLoggedIn, throttleMiddleware(throttle, ctx => String(ctx.session!.userId)))
  async updateGameStatus(ctx: RouterContext): Promise<void> {
    const { gameId } = ctx.params
    const { status } = ctx.request.body

    if (status < GameStatus.Playing || status > GameStatus.Error) {
      throw new httpErrors.BadRequest('invalid game status')
    }

    if (
      (status === GameStatus.Playing || status === GameStatus.Error) &&
      !gameLoader.isLoading(gameId)
    ) {
      throw new httpErrors.Conflict('game must be loading')
    }

    if (status === GameStatus.Playing) {
      if (!gameLoader.registerGameAsLoaded(gameId, ctx.session!.userName)) {
        throw new httpErrors.NotFound('game not found')
      }
    } else if (status === GameStatus.Error) {
      if (!gameLoader.maybeCancelLoading(gameId, ctx.session!.userName)) {
        throw new httpErrors.NotFound('game not found')
      }
    } else {
      throw new httpErrors.BadRequest('invalid game status')
    }

    ctx.status = 204
  }

  @httpPost('/:gameId/results')
  @httpBefore(throttleMiddleware(gameResultsThrottle, ctx => String(ctx.ip)))
  async submitGameResults(ctx: RouterContext): Promise<void> {
    const {
      params: { gameId },
      body: { userId, resultCode, time, playerResults },
    } = validateRequest(ctx, {
      params: GAME_ID_PARAM,
      body: Joi.object<SubmitGameResultsBody>({
        userId: Joi.number().min(0).required(),
        resultCode: Joi.string().required(),
        time: Joi.number().min(0).required(),
        playerResults: Joi.array()
          .items(
            Joi.array()
              .items(
                Joi.string().required(),
                Joi.object({
                  result: Joi.number().min(GameClientResult.Playing).max(GameClientResult.Victory),
                  race: Joi.string().valid('p', 't', 'z'),
                  apm: Joi.number().min(0),
                }).required(),
              )
              .length(2),
          )
          .min(1)
          .max(8)
          .required(),
      }).required(),
    })

    const gameUserRecord = await getUserGameRecord(userId, gameId)
    if (!gameUserRecord || gameUserRecord.resultCode !== resultCode) {
      // TODO(tec27): Should we be giving this info to clients? Should we be giving *more* info?
      throw new httpErrors.NotFound('no matching game found')
    }
    if (gameUserRecord.reportedResults) {
      throw new httpErrors.Conflict('results already reported')
    }

    const namesInResults = playerResults.map(r => r[0])
    const namesToUsers = await findUsersByName(namesInResults)

    const gameRecord = (await getGameRecord(gameId))!
    const playerIdsInGame = new Set(
      gameRecord.config.teams.map(team => team.filter(p => !p.isComputer).map(p => p.id)).flat(),
    )

    for (const [name, user] of namesToUsers.entries()) {
      if (!playerIdsInGame.has(user.id)) {
        throw new httpErrors.BadRequest(`player '${name}' was not found in the game record`)
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

    ctx.status = 204

    // We don't need to hold up the response while we check for reconciling
    Promise.resolve()
      .then(async () => {
        // TODO(tec27): This should probably be moved to games/registration (and that file renamed)
        // since this will be used to check periodically for reconcilable games as well
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

            // TODO(tec27): I think there are still cases, if 2+ users are involved in multiple
            // games that resolve at the same time, that this could deadlock. Won't be a problem for
            // 1v1 but we should handle it when implementing team games

            const mmrs = await getMatchmakingRatingsWithLock(
              client,
              userIds,
              gameRecord.config.gameSourceExtra.type,
            )
            if (mmrs.length !== userIds.length) {
              throw new Error('missing MMR for some users')
            }

            const ratingChanges = calculateChangedRatings(
              gameId,
              reconcileDate,
              reconciled.results,
              mmrs,
            )

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
      })
      .catch(err => {
        if (err.code === UNIQUE_VIOLATION && err.constraint === 'matchmaking_rating_changes_pkey') {
          ctx.log.info({ err }, 'another request already updated rating information')
        } else {
          ctx.log.error(
            { err },
            'checking for and/or updating reconcilable results on submission failed',
          )
        }
      })
  }

  @httpGet('/')
  async streamGameCount(ctx: RouterContext): Promise<Readable> {
    const gameCountEmitter = container.resolve(GameCountEmitter)
    const stream = new Readable({ highWaterMark: 0, read() {} })

    const cleanup = () => {
      gameCountEmitter.removeListener(stream)
      stream.push(null)
    }

    ctx.req.on('close', cleanup).on('finish', cleanup).on('error', cleanup)

    ctx.type = 'text/event-stream'
    ctx.status = 200
    ctx.res.flushHeaders()
    ctx.dontSendSessionCookies = true

    gameCountEmitter.addListener(stream)

    return stream
  }
}
