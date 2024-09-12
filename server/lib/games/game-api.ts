import { RouterContext } from '@koa/router'
import httpErrors from 'http-errors'
import Joi from 'joi'
import Koa from 'koa'
import { Readable } from 'stream'
import { container, inject, singleton } from 'tsyringe'
import { assertUnreachable } from '../../../common/assert-unreachable.js'
import { GameStatus } from '../../../common/game-status.js'
import { GetGameResponse, toGameRecordJson } from '../../../common/games/games.js'
import {
  ALL_GAME_CLIENT_RESULTS,
  GameResultErrorCode,
  SubmitGameResultsRequest,
} from '../../../common/games/results.js'
import { toMapInfoJson } from '../../../common/maps.js'
import { toPublicMatchmakingRatingChangeJson } from '../../../common/matchmaking.js'
import { asHttpError } from '../errors/error-with-payload.js'
import { httpApi, httpBeforeAll } from '../http/http-api.js'
import { httpBefore, httpGet, httpPost, httpPut } from '../http/route-decorators.js'
import logger from '../logging/logger.js'
import { getMapInfo } from '../maps/map-models.js'
import { UpsertUserIp } from '../network/user-ips-type.js'
import ensureLoggedIn from '../session/ensure-logged-in.js'
import createThrottle from '../throttle/create-throttle.js'
import throttleMiddleware from '../throttle/middleware.js'
import { findUsersByIdAsMap } from '../users/user-model.js'
import { joiUserId } from '../users/user-validators.js'
import { validateRequest } from '../validation/joi-validator.js'
import { GameLoader } from './game-loader.js'
import { countCompletedGames } from './game-models.js'
import GameResultService, { GameResultServiceError } from './game-result-service.js'

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

function convertGameResultServiceErrors(err: unknown) {
  if (!(err instanceof GameResultServiceError)) {
    throw err
  }

  switch (err.code) {
    case GameResultErrorCode.NotFound:
      throw asHttpError(404, err)
    case GameResultErrorCode.AlreadyReported:
      throw asHttpError(409, err)
    case GameResultErrorCode.InvalidPlayers:
      throw asHttpError(400, err)
    case GameResultErrorCode.InvalidClient:
      throw asHttpError(400, err)
    default:
      assertUnreachable(err.code)
  }
}

async function convertServiceErrors(ctx: RouterContext, next: Koa.Next) {
  try {
    await next()
  } catch (err) {
    convertGameResultServiceErrors(err)
  }
}

@httpApi('/games')
@httpBeforeAll(convertServiceErrors)
export class GameApi {
  constructor(
    private gameResultService: GameResultService,
    @inject('upsertUserIp') private upsertUserIp: UpsertUserIp,
    private gameLoader: GameLoader,
  ) {}

  @httpGet('/:gameId')
  @httpBefore(throttleMiddleware(throttle, ctx => String(ctx.session?.user?.id) ?? ctx.ip))
  async getGame(ctx: RouterContext): Promise<GetGameResponse> {
    const {
      params: { gameId },
    } = validateRequest(ctx, {
      params: GAME_ID_PARAM,
    })

    const game = await this.gameResultService.retrieveGame(gameId)

    const usersToRetrieve = game.config.teams.flatMap(t =>
      t.filter(p => !p.isComputer).map(p => p.id),
    )
    const [mapArray, users, mmrChanges] = await Promise.all([
      getMapInfo([game.mapId], ctx.session?.user?.id),
      findUsersByIdAsMap(usersToRetrieve),
      this.gameResultService.retrieveMatchmakingRatingChanges(game),
    ])

    return {
      game: toGameRecordJson(game),
      map: mapArray.length ? toMapInfoJson(mapArray[0]) : undefined,
      users: Array.from(users.values()),
      mmrChanges: mmrChanges.map(m => toPublicMatchmakingRatingChangeJson(m)),
    }
  }

  @httpPost('/:gameId/subscribe')
  @httpBefore(ensureLoggedIn, throttleMiddleware(throttle, ctx => String(ctx.session!.user!.id)))
  async subscribeToGame(ctx: RouterContext): Promise<void> {
    const {
      params: { gameId },
      query: { clientId },
    } = validateRequest(ctx, {
      params: GAME_ID_PARAM,
      query: Joi.object<{ clientId: string }>({ clientId: Joi.string().required() }).required(),
    })

    await this.gameResultService.subscribeToGame(ctx.session!.user!.id, clientId, gameId)
    ctx.status = 204
  }

  @httpPost('/:gameId/unsubscribe')
  @httpBefore(ensureLoggedIn, throttleMiddleware(throttle, ctx => String(ctx.session!.user!.id)))
  async unsubscribeFromGame(ctx: RouterContext): Promise<void> {
    const {
      params: { gameId },
      query: { clientId },
    } = validateRequest(ctx, {
      params: GAME_ID_PARAM,
      query: Joi.object<{ clientId: string }>({ clientId: Joi.string().required() }).required(),
    })

    await this.gameResultService.unsubscribeFromGame(ctx.session!.user!.id, clientId, gameId)
    ctx.status = 204
  }

  @httpPut('/:gameId/status')
  @httpBefore(ensureLoggedIn, throttleMiddleware(throttle, ctx => String(ctx.session!.user!.id)))
  async updateGameStatus(ctx: RouterContext): Promise<void> {
    const { gameId } = ctx.params
    const { status } = ctx.request.body
    const user = ctx.session!.user!

    if (status < GameStatus.Playing || status > GameStatus.Error) {
      throw new httpErrors.BadRequest('invalid game status')
    }

    if (
      (status === GameStatus.Playing || status === GameStatus.Error) &&
      !this.gameLoader.isLoading(gameId)
    ) {
      throw new httpErrors.Conflict('game must be loading')
    }

    if (status === GameStatus.Playing) {
      if (!this.gameLoader.registerGameAsLoaded(gameId, user.name)) {
        throw new httpErrors.NotFound('game not found')
      }
    } else if (status === GameStatus.Error) {
      if (!this.gameLoader.maybeCancelLoading(gameId, user.name)) {
        throw new httpErrors.NotFound('game not found')
      }
    } else {
      throw new httpErrors.BadRequest('invalid game status')
    }

    ctx.status = 204
  }

  // NOTE(tec27): This doesn't require being logged in because the game client sends these requests,
  // the body is intended to be secret per user and authenticate that they are the one who sent it.
  @httpPost('/:gameId/results2')
  @httpBefore(throttleMiddleware(gameResultsThrottle, ctx => String(ctx.ip)))
  async submitGameResults(ctx: RouterContext): Promise<void> {
    const {
      params: { gameId },
      body: { userId, resultCode, time, playerResults },
    } = validateRequest(ctx, {
      params: GAME_ID_PARAM,
      body: Joi.object<SubmitGameResultsRequest>({
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
      }).required(),
    })

    await this.gameResultService.submitGameResults({
      gameId,
      userId,
      resultCode,
      time,
      playerResults,
      logger: ctx.log,
    })

    // If it was successful, record this user's IP for that account, since the normal middleware
    // to do so won't have run
    this.upsertUserIp(userId, ctx.ip).catch(err => {
      logger.error({ err }, 'error upserting user IP')
    })

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
