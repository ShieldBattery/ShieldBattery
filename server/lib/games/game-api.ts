import { RouterContext } from '@koa/router'
import httpErrors from 'http-errors'
import Joi from 'joi'
import { Readable } from 'stream'
import { container, singleton } from 'tsyringe'
import { GameStatus } from '../../../common/game-status'
import { GetGamePayload, toGameRecordJson } from '../../../common/games/games'
import { toMapInfoJson } from '../../../common/maps'
import { httpApi } from '../http/http-api'
import { httpBefore, httpGet, httpPut } from '../http/route-decorators'
import logger from '../logging/logger'
import { getMapInfo } from '../maps/map-models'
import ensureLoggedIn from '../session/ensure-logged-in'
import createThrottle from '../throttle/create-throttle'
import throttleMiddleware from '../throttle/middleware'
import { findUsersById } from '../users/user-model'
import { validateRequest } from '../validation/joi-validator'
import gameLoader from './game-loader'
import { countCompletedGames, getGameRecord } from './game-models'

const throttle = createThrottle('games', {
  rate: 20,
  burst: 40,
  window: 60000,
})

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
      params: Joi.object<{ gameId: string }>({
        gameId: Joi.string().required(),
      }),
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

  // TODO(tec27): Make this a sub-route under /:gameId, e.g. /:gameId/status or something
  @httpPut('/:gameId')
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
