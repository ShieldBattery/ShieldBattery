import { RouterContext } from '@koa/router'
import httpErrors from 'http-errors'
import Joi from 'joi'
import Koa from 'koa'
import { Readable } from 'stream'
import { container, inject, singleton } from 'tsyringe'
import { assertUnreachable } from '../../../common/assert-unreachable'
import { GameSource } from '../../../common/games/configuration'
import { GameStatus } from '../../../common/games/game-status'
import {
  GameDebugInfo,
  GameRecord,
  GameReplayInfo,
  GetGameResponse,
  toGameDebugInfoJson,
  toGameRecordJson,
} from '../../../common/games/games'
import {
  ALL_GAME_CLIENT_RESULTS,
  GameResultErrorCode,
  SubmitGameReplayRequest,
  SubmitGameResultsRequest,
} from '../../../common/games/results'
import { toMapInfoJson } from '../../../common/maps'
import { toPublicMatchmakingRatingChangeJson } from '../../../common/matchmaking'
import { SbUserId } from '../../../common/users/sb-user-id'
import { parseReplay } from '../../workers/replays/replays'
import { asHttpError } from '../errors/error-with-payload'
import { handleMultipartFiles } from '../files/handle-multipart-files'
import { httpApi, httpBeforeAll } from '../http/http-api'
import { httpBefore, httpGet, httpPost, httpPut } from '../http/route-decorators'
import logger from '../logging/logger'
import { getMapInfos } from '../maps/map-models'
import { getGameReportedResults, getUserGameRecord } from '../models/games-users'
import { UpsertUserIp } from '../network/user-ips-type'
import { generateReplayFilename } from '../replays/replay-filenames'
import { getAllReplaysForGame, getBestReplayForGame } from '../replays/replay-models'
import { ReplayService } from '../replays/replay-service'
import ensureLoggedIn from '../session/ensure-logged-in'
import createThrottle from '../throttle/create-throttle'
import throttleMiddleware from '../throttle/middleware'
import { findUsersByIdAsMap } from '../users/user-model'
import { joiUserId } from '../users/user-validators'
import { validateRequest } from '../validation/joi-validator'
import { GameLoader } from './game-loader'
import { countCompletedGames, getGameRoutes } from './game-models'
import GameResultService, { GameResultServiceError } from './game-result-service'

/** Maximum size of a replay file that we allow to be uploaded. */
const MAX_REPLAY_SIZE_BYTES = 5 * 1024 * 1024

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

/**
 * Determines if a user can access replays for a game.
 * - Matchmaking games: any user can access
 * - Lobby games: only participants can access
 */
function canUserAccessReplay(game: GameRecord, userId: SbUserId | undefined): boolean {
  if (game.config.gameSource === GameSource.Matchmaking) {
    return true
  }

  if (game.config.gameSource === GameSource.Lobby) {
    if (!userId) {
      return false
    }
    // Check if user was a participant
    const allPlayers = game.config.teams.flat()
    return allPlayers.some(p => !p.isComputer && p.id === userId)
  }

  return false
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
    case GameResultErrorCode.NotLoaded:
      throw asHttpError(409, err)
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
    private replayService: ReplayService,
  ) {}

  @httpGet('/:gameId')
  @httpBefore(throttleMiddleware(throttle, ctx => String(ctx.session?.user?.id ?? ctx.ip)))
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
      getMapInfos([game.mapId]),
      findUsersByIdAsMap(usersToRetrieve),
      this.gameResultService.retrieveMatchmakingRatingChanges(game),
    ])

    const mapName = mapArray[0]?.name ?? 'Unknown Map'

    // Check replay access
    const currentUserId = ctx.session?.user?.id
    const canAccessReplay = canUserAccessReplay(game, currentUserId)

    let replay: GameReplayInfo | undefined
    if (canAccessReplay) {
      try {
        const bestReplay = await getBestReplayForGame(gameId)
        if (bestReplay) {
          const filename = generateReplayFilename(game, mapName)
          replay = {
            id: bestReplay.id,
            url: await this.replayService.getReplayDownloadUrl(bestReplay.id, filename),
            hash: bestReplay.hash.toString('hex'),
          }
        }
      } catch (err) {
        ctx.log.error({ err }, 'Error retrieving replay info for game')
      }
    }

    // Check for debug permission and add debug info if authorized
    let debugInfo: GameDebugInfo | undefined
    if (ctx.session?.permissions?.debug) {
      try {
        const [routes, reportedResults, allReplays] = await Promise.all([
          getGameRoutes(gameId),
          getGameReportedResults(gameId),
          getAllReplaysForGame(gameId),
        ])

        const replayDebugInfo = await Promise.all(
          allReplays.map(async r => ({
            id: r.id,
            uploadedByUserId: r.uploadedByGameUserId,
            // Append uploader user ID to distinguish multiple replays
            url: await this.replayService.getReplayDownloadUrl(
              r.id,
              `${generateReplayFilename(game, mapName)}-${r.uploadedByGameUserId}`,
            ),
            hash: r.hash.toString('hex'),
            frames: r.header?.frames ?? null,
          })),
        )

        debugInfo = {
          routes,
          reportedResults,
          replays: replayDebugInfo.length > 0 ? replayDebugInfo : undefined,
        }
      } catch (err) {
        // Log error but don't fail the request
        ctx.log.error({ err }, 'Error retrieving debug info for game')
      }
    }

    return {
      game: toGameRecordJson(game),
      map: mapArray.length ? toMapInfoJson(mapArray[0]) : undefined,
      users: Array.from(users.values()),
      mmrChanges: mmrChanges.map(m => toPublicMatchmakingRatingChangeJson(m)),
      replay,
      debugInfo: debugInfo ? toGameDebugInfoJson(debugInfo) : undefined,
    }
  }

  @httpPost('/:gameId/subscribe')
  @httpBefore(ensureLoggedIn, throttleMiddleware(throttle, ctx => String(ctx.session!.user.id)))
  async subscribeToGame(ctx: RouterContext): Promise<void> {
    const {
      params: { gameId },
      query: { clientId },
    } = validateRequest(ctx, {
      params: GAME_ID_PARAM,
      query: Joi.object<{ clientId: string }>({ clientId: Joi.string().required() }).required(),
    })

    await this.gameResultService.subscribeToGame(ctx.session!.user.id, clientId, gameId)
    ctx.status = 204
  }

  @httpPost('/:gameId/unsubscribe')
  @httpBefore(ensureLoggedIn, throttleMiddleware(throttle, ctx => String(ctx.session!.user.id)))
  async unsubscribeFromGame(ctx: RouterContext): Promise<void> {
    const {
      params: { gameId },
      query: { clientId },
    } = validateRequest(ctx, {
      params: GAME_ID_PARAM,
      query: Joi.object<{ clientId: string }>({ clientId: Joi.string().required() }).required(),
    })

    await this.gameResultService.unsubscribeFromGame(ctx.session!.user.id, clientId, gameId)
    ctx.status = 204
  }

  @httpPut('/:gameId/status')
  @httpBefore(ensureLoggedIn, throttleMiddleware(throttle, ctx => String(ctx.session!.user.id)))
  async updateGameStatus(ctx: RouterContext): Promise<void> {
    const {
      params: { gameId },
      body: { status },
    } = validateRequest(ctx, {
      params: GAME_ID_PARAM,
      body: Joi.object<{ status: GameStatus; extra: any }>({
        status: Joi.number().min(GameStatus.Launching).max(GameStatus.Error).required(),
        extra: Joi.any().optional(), // unused currently
      }),
    })
    const user = ctx.session!.user

    if (status > GameStatus.Finished && status !== GameStatus.Error) {
      throw new httpErrors.BadRequest('invalid game status')
    }

    if (
      ((status >= GameStatus.Launching && status <= GameStatus.Playing) ||
        status === GameStatus.Error) &&
      !this.gameLoader.isLoadingOrRecentlyLoaded(gameId)
    ) {
      throw new httpErrors.Conflict('game must be loading')
    }

    if (status < GameStatus.Playing) {
      // TODO(tec27): Tell the game loader about this so it can better assign fault for failing to
      // load
    } else if (status === GameStatus.Playing) {
      if (!this.gameLoader.registerGameAsLoaded(gameId, user.id)) {
        throw new httpErrors.NotFound('game not found')
      }
    } else if (status === GameStatus.Error) {
      if (!this.gameLoader.maybeCancelLoading(gameId, user.id)) {
        throw new httpErrors.NotFound('game not found')
      }
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

    if (this.gameLoader.isLoading(gameId)) {
      throw new GameResultServiceError(
        GameResultErrorCode.NotLoaded,
        'Game is still loading, try again later',
      )
    }

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

  // NOTE(tec27): This doesn't require being logged in because the game client sends these requests,
  // the body is intended to be secret per user and authenticate that they are the one who sent it.
  @httpPost('/:gameId/replay')
  @httpBefore(
    throttleMiddleware(gameResultsThrottle, ctx => String(ctx.ip)),
    handleMultipartFiles(MAX_REPLAY_SIZE_BYTES),
  )
  async submitGameReplay(ctx: RouterContext): Promise<void> {
    const {
      params: { gameId },
      body: { userId, resultCode },
    } = validateRequest(ctx, {
      params: GAME_ID_PARAM,
      body: Joi.object<SubmitGameReplayRequest>().keys({
        userId: Joi.number().min(0).required(),
        resultCode: Joi.string().required(),
      }),
    })

    if (this.gameLoader.isLoading(gameId)) {
      throw new GameResultServiceError(
        GameResultErrorCode.NotLoaded,
        'Game is still loading, try again later',
      )
    }

    // Validate resultCode matches what's stored for this user/game
    const gameUserRecord = await getUserGameRecord(userId, gameId)
    if (!gameUserRecord || gameUserRecord.resultCode !== resultCode) {
      throw new GameResultServiceError(GameResultErrorCode.NotFound, 'no matching game found')
    }

    // Only accept the first replay upload for a user/game
    if (gameUserRecord.replayFileId) {
      ctx.status = 204
      return
    }

    const replayFile = ctx.request.files?.replay
    if (!replayFile || Array.isArray(replayFile)) {
      throw new httpErrors.BadRequest('exactly one replay file must be uploaded')
    }

    const parseResult = await parseReplay(replayFile.filepath)
    if (parseResult.error) {
      throw new httpErrors.BadRequest('failed to parse replay file')
    }

    await this.replayService.storeReplay(replayFile.filepath, parseResult.value, {
      gameId,
      userId,
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
