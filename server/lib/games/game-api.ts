import { RouterContext } from '@koa/router'
import httpErrors from 'http-errors'
import Joi from 'joi'
import Koa from 'koa'
import { Readable } from 'stream'
import { container, inject, singleton } from 'tsyringe'
import { assertUnreachable } from '../../../common/assert-unreachable'
import {
  ALL_GAME_FORMATS,
  decodeMatchup,
  GameDurationFilter,
  GameSortOption,
} from '../../../common/games/game-filters'
import { GameStatus } from '../../../common/games/game-status'
import { GameType } from '../../../common/games/game-type'
import {
  GameDebugInfo,
  GameReplayInfo,
  GET_GAMES_LIMIT,
  GetGameResponse,
  GetGamesQueryParams,
  GetGamesResponse,
  MAX_GAMES_OFFSET,
  NullifyGamePointsRequest,
  NullifyGamePointsResponse,
  toGameDebugInfoJson,
  toGameRecordJson,
} from '../../../common/games/games'
import {
  NetcodeV2RehomeRequest,
  NetcodeV2RehomeResponse,
  SubmitNetcodeV2PubkeyRequest,
} from '../../../common/games/netcode-v2'
import {
  GameResultErrorCode,
  isRawStoredGameResults,
  RawGameResultsReport,
  SubmitGameReplayRequest,
  SubmitGameResultsRequest,
} from '../../../common/games/results'
import { SbMapId, toMapInfoJson } from '../../../common/maps'
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
import { NetcodeV2Service } from '../netcode-v2/netcode-v2-service'
import { UpsertUserIp } from '../network/user-ips-type'
import { checkAllPermissions } from '../permissions/check-permissions'
import { canUserAccessReplay } from '../replays/replay-access'
import { generateReplayFilename } from '../replays/replay-filenames'
import { getReplayInfosForGames } from '../replays/replay-info'
import { getAllReplaysForGame, getBestReplayForGame } from '../replays/replay-models'
import { ReplayService } from '../replays/replay-service'
import ensureLoggedIn from '../session/ensure-logged-in'
import createThrottle from '../throttle/create-throttle'
import throttleMiddleware from '../throttle/middleware'
import { findUsersById, findUsersByIdAsMap } from '../users/user-model'
import { joiUserId } from '../users/user-validators'
import { validateRequest } from '../validation/joi-validator'
import { GameLoader } from './game-loader'
import { countCompletedGames, getGameRoutes, getGames, getNetcodeV2Session } from './game-models'
import {
  GamePointsRefundErrorCode,
  GamePointsRefundService,
  GamePointsRefundServiceError,
} from './game-points-refund-service'
import GameResultService, {
  GameResultServiceError,
  isResultsExempt,
  SUBMIT_GAME_RESULTS_REQUEST_SCHEMA,
  usedNetcodeV2,
} from './game-result-service'
import { deriveResultSubmission } from './raw-results'

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

const gamesListThrottle = createThrottle('gamesList', {
  rate: 20,
  burst: 40,
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
    case GameResultErrorCode.NotLoaded:
      throw asHttpError(409, err)
    case GameResultErrorCode.RelayReportRequired:
      throw asHttpError(409, err)
    case GameResultErrorCode.ResultsNotTracked:
      throw asHttpError(409, err)
    default:
      assertUnreachable(err.code)
  }
}

function convertGamePointsRefundErrors(err: unknown) {
  if (!(err instanceof GamePointsRefundServiceError)) {
    throw err
  }

  switch (err.code) {
    case GamePointsRefundErrorCode.GameNotFound:
      throw asHttpError(404, err)
    case GamePointsRefundErrorCode.NotCurrentSeason:
    case GamePointsRefundErrorCode.NotRanked:
    case GamePointsRefundErrorCode.NotRefundable:
    case GamePointsRefundErrorCode.InvalidPlayers:
      throw asHttpError(400, err)
    case GamePointsRefundErrorCode.AlreadyRefunded:
      throw asHttpError(409, err)
    default:
      assertUnreachable(err.code)
  }
}

async function convertServiceErrors(ctx: RouterContext, next: Koa.Next) {
  try {
    await next()
  } catch (err) {
    if (err instanceof GamePointsRefundServiceError) {
      convertGamePointsRefundErrors(err)
    }
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
    private gamePointsRefundService: GamePointsRefundService,
    private netcodeV2Service: NetcodeV2Service,
  ) {}

  @httpPost('/:gameId/nullify-points')
  @httpBefore(ensureLoggedIn, checkAllPermissions('manageGameReports'))
  async nullifyGamePoints(ctx: RouterContext): Promise<NullifyGamePointsResponse> {
    const {
      params: { gameId },
      body: { punishedUserIds },
    } = validateRequest(ctx, {
      params: GAME_ID_PARAM,
      body: Joi.object<NullifyGamePointsRequest>({
        // `.single()` because the client sends this via `encodeBodyAsParams`, which serializes a
        // one-element array as a single `punishedUserIds=<id>` param that the body parser decodes as
        // a scalar (the usual convention here — see user-api.ts / chat-api.ts). A 3v3 is the largest
        // matchmaking game, so at most 6 punished players; keep a little slack.
        punishedUserIds: Joi.array().items(joiUserId()).single().min(1).max(8).required(),
      }),
    })

    return await this.gamePointsRefundService.refundGamePoints({
      gameId,
      punishedUserIds,
      refundedBy: ctx.session!.user.id,
    })
  }

  @httpGet('/list')
  @httpBefore(throttleMiddleware(gamesListThrottle, ctx => String(ctx.session?.user?.id ?? ctx.ip)))
  async getGamesList(ctx: RouterContext): Promise<GetGamesResponse> {
    const {
      query: { duration, mapName, playerName, format, matchup, sort, offset },
    } = validateRequest(ctx, {
      query: Joi.object<GetGamesQueryParams>({
        duration: Joi.string().valid(...Object.values(GameDurationFilter)),
        mapName: Joi.string().max(100),
        playerName: Joi.string().max(100),
        format: Joi.string().valid(...ALL_GAME_FORMATS),
        matchup: Joi.string().pattern(/^[ptz_]{1,4}-[ptz_]{1,4}$/),
        sort: Joi.string().valid(...Object.values(GameSortOption)),
        // This is a public endpoint, so we cap the offset to avoid forcing the DB to produce (and
        // sort) an unbounded number of rows. `.integer()` is needed because Joi otherwise accepts
        // e.g. `1.5`, which produces an invalid `OFFSET 1.5` and 500s on the bigint cast.
        offset: Joi.number().integer().min(0).max(MAX_GAMES_OFFSET),
      }),
    })

    const decodedMatchup = matchup && format ? decodeMatchup(format, matchup) : undefined

    const games = await getGames({
      limit: GET_GAMES_LIMIT,
      offset: offset ?? 0,
      duration,
      mapName,
      playerName,
      format,
      matchup: decodedMatchup,
      sort,
    })

    const uniqueUsers = new Set<SbUserId>()
    const uniqueMaps = new Set<SbMapId>()
    for (const g of games) {
      uniqueMaps.add(g.mapId)

      for (const team of g.config.teams) {
        for (const player of team) {
          if (!player.isComputer) {
            uniqueUsers.add(player.id)
          }
        }
      }
    }

    const [users, maps] = await Promise.all([
      findUsersById(Array.from(uniqueUsers.values())),
      getMapInfos(Array.from(uniqueMaps.values())),
    ])

    const currentUserId = ctx.session?.user?.id
    const mapNameById = new Map(maps.map(m => [m.id, m.name]))
    const replays = await getReplayInfosForGames({
      games,
      currentUserId,
      mapNameById,
      replayService: this.replayService,
      logger: ctx.log,
    })

    return {
      games: games.map(g => toGameRecordJson(g)),
      maps: maps.map(m => toMapInfoJson(m)),
      users,
      hasMoreGames: games.length >= GET_GAMES_LIMIT,
      replays,
    }
  }

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
            gameId,
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

        // The debug view shows per-player verdicts. A raw (v2) report is undigested, so derive its
        // verdicts (the same way reconciliation would) before displaying it.
        const isUms = game.config.gameType === GameType.UseMapSettings
        const debugReportedResults = reportedResults.map(r => {
          if (r.reportedResults && isRawStoredGameResults(r.reportedResults)) {
            const derived = deriveResultSubmission(r.reportedResults, r.userId, { isUms })
            return {
              userId: r.userId,
              reportedAt: r.reportedAt,
              reportedResults: { time: derived.time, playerResults: derived.playerResults },
            }
          }
          return { userId: r.userId, reportedAt: r.reportedAt, reportedResults: r.reportedResults }
        })

        debugInfo = {
          routes,
          reportedResults: debugReportedResults,
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

  @httpPut('/:gameId/netcodeV2Pubkey')
  @httpBefore(ensureLoggedIn, throttleMiddleware(throttle, ctx => String(ctx.session!.user.id)))
  async submitNetcodeV2Pubkey(ctx: RouterContext): Promise<void> {
    const {
      params: { gameId },
      body: { pubkey },
    } = validateRequest(ctx, {
      params: GAME_ID_PARAM,
      body: Joi.object<SubmitNetcodeV2PubkeyRequest>({
        pubkey: Joi.string().base64().max(64).required(),
      }).required(),
    })

    if (!this.netcodeV2Service.isEnabled()) {
      throw new httpErrors.NotFound('netcode v2 is not enabled')
    }
    // Only participants of the loading game may register a key — anyone else could otherwise fill
    // the game's pubkey state and grief the load.
    if (!this.gameLoader.isLoadingForUser(gameId, ctx.session!.user.id)) {
      throw new httpErrors.Conflict('game must be loading for this user')
    }
    if (!this.netcodeV2Service.registerPubkey(gameId, ctx.session!.user.id, pubkey)) {
      throw new httpErrors.BadRequest('invalid pubkey')
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
      body,
    } = validateRequest(ctx, {
      params: GAME_ID_PARAM,
      body: SUBMIT_GAME_RESULTS_REQUEST_SCHEMA,
    })
    const report = body as SubmitGameResultsRequest | RawGameResultsReport

    if (this.gameLoader.isLoading(gameId)) {
      throw new GameResultServiceError(
        GameResultErrorCode.NotLoaded,
        'Game is still loading, try again later',
      )
    }

    const gameRecord = await this.gameResultService.retrieveGame(gameId)

    // A game with computer players never tracks results at all, so it rejects with a distinct code
    // rather than the (misleading, for this case) relay-report requirement below — checked first
    // since an exempt v2 game should report "not tracked", not "use the relay".
    if (isResultsExempt(gameRecord.config)) {
      throw new GameResultServiceError(
        GameResultErrorCode.ResultsNotTracked,
        'results are not tracked for games with computer players',
      )
    }

    // A netcode-v2 game's result can only reach the server through the relay's signed webhook —
    // this direct endpoint stays open for pre-cutover clients, but a v2 game must reject it so
    // there's no untrusted side door around the relay's guarantees.
    if (usedNetcodeV2(gameRecord.config)) {
      throw new GameResultServiceError(
        GameResultErrorCode.RelayReportRequired,
        'netcode v2 games must report results through the relay',
      )
    }

    await this.gameResultService.submitGameResults({
      gameId,
      report,
      logger: ctx.log,
    })

    // If it was successful, record this user's IP for that account, since the normal middleware
    // to do so won't have run
    this.upsertUserIp(report.userId, ctx.ip).catch(err => {
      logger.error({ err }, 'error upserting user IP')
    })

    ctx.status = 204
  }

  // NOTE(tec27): Like the results/replay endpoints this doesn't require being logged in — the game
  // client authenticates by presenting the per-(game, user) resultCode the server minted, which is
  // secret to that user. The game client posts here when its home relay looks dead and it needs the
  // session re-homed; the server (not the client) does the tenant-signed coordinator round trip.
  @httpPost('/:gameId/netcodeV2Rehome')
  @httpBefore(throttleMiddleware(gameResultsThrottle, ctx => String(ctx.ip)))
  async netcodeV2Rehome(ctx: RouterContext): Promise<NetcodeV2RehomeResponse> {
    const {
      params: { gameId },
      body: { userId, resultCode, deadRelayId },
    } = validateRequest(ctx, {
      params: GAME_ID_PARAM,
      body: Joi.object<NetcodeV2RehomeRequest>().keys({
        // `.integer()`: `userId` is an account id and `deadRelayId` is a coordinator u64 relay id
        // — a fractional value (e.g. `1.5`) is meaningless and would only fail downstream at the
        // coordinator, so reject it here.
        userId: Joi.number().integer().min(0).required(),
        resultCode: Joi.string().required(),
        deadRelayId: Joi.number().integer().min(0).required(),
      }),
    })

    if (!this.netcodeV2Service.isEnabled()) {
      throw new httpErrors.NotFound('netcode v2 is not enabled')
    }
    if (this.gameLoader.isLoading(gameId)) {
      throw new GameResultServiceError(
        GameResultErrorCode.NotLoaded,
        'Game is still loading, try again later',
      )
    }

    // Same auth as the replay upload: the resultCode must match what's stored for this user/game.
    const gameUserRecord = await getUserGameRecord(userId, gameId)
    if (!gameUserRecord || gameUserRecord.resultCode !== resultCode) {
      throw new GameResultServiceError(GameResultErrorCode.NotFound, 'no matching game found')
    }

    // Only a user still actively in the game may drive failover. A user who has already submitted a
    // result, or whose mid-game departure the relay recorded, is done — and letting a done (e.g.
    // departed) player keep asking to re-home would let them drain the coordinator's per-session
    // rehome rate-limit bucket and 429 a real survivor's failover. This is the same "human is done"
    // predicate `areAllHumansAccountedFor` keys on (reported a result, or has a recorded departure).
    if (gameUserRecord.reportedResults != null || gameUserRecord.departureKind != null) {
      throw new GameResultServiceError(
        GameResultErrorCode.AlreadyReported,
        'game participant has already finished and cannot re-home',
      )
    }

    // Only a live netcode-v2 game with a coordinator session on record can be re-homed.
    const session = await getNetcodeV2Session(gameId)
    if (session === null) {
      throw new httpErrors.Conflict('game has no active netcode v2 session')
    }

    // The route framework uses the handler's return value as the response body (see http-api.ts) —
    // assigning ctx.body here would be overwritten with undefined.
    return await this.netcodeV2Service.rehomeSession(session, deadRelayId)
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
