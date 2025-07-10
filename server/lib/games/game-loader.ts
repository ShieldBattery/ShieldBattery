import { Map as IMap, List, Record, Set } from 'immutable'
import { Counter, Histogram, linearBuckets } from 'prom-client'
import { container, singleton } from 'tsyringe'
import { Result } from 'typescript-result'
import CancelToken, { MultiCancelToken } from '../../../common/async/cancel-token'
import createDeferred, { Deferred } from '../../../common/async/deferred'
import rejectOnTimeout from '../../../common/async/reject-on-timeout'
import { GameConfig, GameSource } from '../../../common/games/configuration'
import { GameRoute, GameSetup, PlayerInfo } from '../../../common/games/game-launch-config'
import { GameLoaderEvent } from '../../../common/games/game-loader-network'
import { GameRouteDebugInfo } from '../../../common/games/games'
import { Slot } from '../../../common/lobbies/slot'
import { MapInfo, toMapInfoJson } from '../../../common/maps'
import { BwTurnRate, BwUserLatency, turnRateToMaxLatency } from '../../../common/network'
import { urlPath } from '../../../common/urls'
import { SbUser } from '../../../common/users/sb-user'
import { SbUserId } from '../../../common/users/sb-user-id'
import { CodedError } from '../errors/coded-error'
import log from '../logging/logger'
import { getMapInfo } from '../maps/map-models'
import { deleteUserRecordsForGame } from '../models/games-users'
import { RallyPointRouteInfo, RallyPointService } from '../rally-point/rally-point-service'
import { findUsersById } from '../users/user-model'
import { TypedPublisher } from '../websockets/typed-publisher'
import { deleteRecordForGame, updateRouteDebugInfo } from './game-models'
import { GameplayActivityRegistry } from './gameplay-activity-registry'
import { registerGame } from './registration'

const GAME_LOAD_TIMEOUT = 60 * 1000

// NOTE(tec27): It's important that these are sorted low -> high
const POTENTIAL_TURN_RATES: ReadonlyArray<BwTurnRate> = [12, 14, 16, 20, 24]
/**
 * Entries of turn rate -> the max latency that is allowed to auto-pick that turn rate. These values
 * are chosen to work initially on low latency, although with significant packet loss may need to be
 * bumped higher. (This is a stop-gap measure, longer-term our netcode should be able to adjust on
 * the fly.)
 */
const MAX_LATENCIES_LOW: ReadonlyArray<[turnRate: BwTurnRate, maxLatency: number]> =
  POTENTIAL_TURN_RATES.map(turnRate => [
    turnRate,
    turnRateToMaxLatency(turnRate, BwUserLatency.Low),
  ])
/**
 * Latencies to check if none of the MAX_LATENCIES_LOW work. At that point we pick a latency based
 * on what would be optimal for the "High" ingame latency setting.
 */
const MAX_LATENCIES_HIGH: ReadonlyArray<[turnRate: BwTurnRate, maxLatency: number]> =
  POTENTIAL_TURN_RATES.map(turnRate => [
    turnRate,
    turnRateToMaxLatency(turnRate, BwUserLatency.High),
  ])

export enum GameLoadErrorType {
  /** The game load request was canceled before it completed. */
  Canceled = 'canceled',
  /** An internal error occurred while trying to load the game. */
  Internal = 'internal',
  /** A specific player failed to load. */
  PlayerFailed = 'playerFailed',
  /** Loading the game timed out before it finished. */
  Timeout = 'timeout',
}

type GameLoadErrorTypeToData = {
  [GameLoadErrorType.PlayerFailed]: {
    userId: SbUserId
  }
  [GameLoadErrorType.Timeout]: {
    unloaded: SbUserId[]
  }

  [GameLoadErrorType.Canceled]: undefined
  [GameLoadErrorType.Internal]: undefined
}

export class BaseGameLoaderError<
  T extends GameLoadErrorType = GameLoadErrorType,
> extends CodedError<T, GameLoadErrorTypeToData[T]> {}

export type GameLoaderError =
  | BaseGameLoaderError<GameLoadErrorType.Canceled>
  | BaseGameLoaderError<GameLoadErrorType.Internal>
  | BaseGameLoaderError<GameLoadErrorType.PlayerFailed>
  | BaseGameLoaderError<GameLoadErrorType.Timeout>

function generateSeed() {
  // BWChart and some other replay sites/libraries utilize the random seed as the date the game was
  // played, so we match BW's random seed method (time()) here
  return (Date.now() / 1000) | 0
}

interface RouteResult extends RallyPointRouteInfo {
  p1Slot: Slot
  p2Slot: Slot
}

function createRoutes(players: Set<Slot>): Promise<RouteResult[]> {
  // Generate all the pairings of players to figure out the routes we need
  const matchGen: Array<[Slot, Set<Slot>]> = []
  let rest = players
  while (!rest.isEmpty()) {
    const first = rest.first<Slot>()
    rest = rest.rest()
    if (!rest.isEmpty()) {
      matchGen.push([first, rest])
    }
  }
  const needRoutes = matchGen.reduce(
    (result, [p1, players]) => {
      players.forEach(p2 => result.push([p1, p2]))
      return result
    },
    [] as Array<[Slot, Slot]>,
  )

  const rallyPointService = container.resolve(RallyPointService)
  const activityRegistry = container.resolve(GameplayActivityRegistry)

  return Promise.all(
    needRoutes.map(([p1, p2]) =>
      rallyPointService
        .createBestRoute(
          activityRegistry.getClientForUser(p1.userId!)!,
          activityRegistry.getClientForUser(p2.userId!)!,
        )
        .then(result => ({ ...result, p1Slot: p1, p2Slot: p2 })),
    ),
  )
}

const createLoadingData = Record({
  gameSource: GameSource.Lobby,
  players: Set<Slot>(),
  finishedPlayers: Set<SbUserId>(),
  cancelToken: null as unknown as CancelToken,
  deferred: null as unknown as Deferred<Result<void, GameLoaderError>>,
})

type LoadingData = ReturnType<typeof createLoadingData>

const LoadingDatas = {
  isAllFinished(loadingData: LoadingData) {
    return loadingData.players.every(p => loadingData.finishedPlayers.has(p.userId!))
  },
}

export interface GameSetupGameInfo {
  gameId: string
  seed: number
  turnRate?: BwTurnRate | 0
  userLatency?: BwUserLatency
  useLegacyLimits?: boolean
}

/**
 * Parameters to `GameLoader.loadGame`.
 */
export interface GameLoadRequest {
  /**
   * A list of players that should be created as human (or observer) type slots. At least one player
   * should be present for things to work properly.
   */
  players: Iterable<Slot>
  /**
   * A list of the info about each slot in the map/lobby. This is only really useful data for UMS
   * lobbies, where slots may have different types, there might be hidden computer slots, etc. For
   * a lobby, see `getPlayerInfos(Lobby)`. For matchmaking this can just be created from `players`
   * directly.
   */
  playerInfos: PlayerInfo[]
  /**
   * The ID of the map that the game will be played on.
   */
  mapId: string
  /**
   * Configuration info for the game.
   */
  gameConfig: GameConfig
  /**
   * Optional list of rating entries for each player in the game. This only need to be provided for
   * matchmaking games.
   */
  ratings?: Array<[id: SbUserId, rating: number]>
  /** A `CancelToken` that can be used to cancel the loading process midway through. */
  cancelToken?: CancelToken
}

function gameUserPath(gameId: string, userId: SbUserId) {
  return urlPath`/gameLoader/${gameId}/${userId}`
}

/** Returns the `GameSetup` for a game without any user-specific data. */
function getGeneralGameSetup({
  gameConfig,
  playerInfos,
  users,
  ratings,
  map,
  gameId,
  seed,
  turnRate,
  userLatency,
}: {
  gameConfig: GameConfig
  playerInfos: PlayerInfo[]
  users: SbUser[]
  ratings?: Array<[id: SbUserId, rating: number]>
  map: MapInfo
  gameId: string
  seed: number
  turnRate: BwTurnRate | 0 | undefined
  userLatency: BwUserLatency | undefined
}): Exclude<GameSetup, 'resultCode'> {
  if (gameConfig.gameSource === GameSource.Lobby) {
    // NOTE(tec27): For launching lobbies this should now always be set (the optional bit is just
    // for DB-stored configs), but we fall back to the first human player just in case
    let host: PlayerInfo | undefined
    if (gameConfig.gameSourceExtra?.host) {
      host = playerInfos.find(p => p.userId === gameConfig.gameSourceExtra!.host)
    }
    if (!host) {
      host = playerInfos.find(p => p.type === 'human' && p.userId)!
    }

    return {
      gameId,
      name: 'ShieldBattery Lobby',
      map: toMapInfoJson(map),
      gameType: gameConfig.gameType,
      gameSubType: gameConfig.gameSubType,
      slots: playerInfos,
      host,
      users,
      seed,
      turnRate,
      userLatency,
      useLegacyLimits: gameConfig.gameSourceExtra?.useLegacyLimits,
    }
  } else if (gameConfig.gameSource === GameSource.Matchmaking) {
    return {
      gameId,
      name: 'ShieldBattery Matchmaking',
      map: toMapInfoJson(map),
      gameType: gameConfig.gameType,
      gameSubType: gameConfig.gameSubType,
      slots: playerInfos,
      host: playerInfos[0],
      users,
      ratings,
      disableAllianceChanges: true,
      seed,
      turnRate,
      userLatency,
    }
  } else {
    return gameConfig satisfies never
  }
}

@singleton()
export class GameLoader {
  // Maps game id -> loading data
  private loadingGames = IMap<string, LoadingData>()

  private gameLoadRequestsTotalMetric = new Counter({
    name: 'shieldbattery_game_loader_requests_total',
    labelNames: ['game_source'],
    help: 'Total number of game load requests',
  })
  private gameLoadFailuresTotalMetric = new Counter({
    name: 'shieldbattery_game_loader_failures_total',
    // TODO(tec27): Add failure types?
    labelNames: ['game_source'],
    help: 'Total number of game load requests that failed',
  })
  private gameLoadSuccessesTotalMetric = new Counter({
    name: 'shieldbattery_game_loader_successes_total',
    labelNames: ['game_source'],
    help: 'Total number of game load requests that succeeded',
  })
  private maxEstimatedLatencyMetric = new Histogram({
    name: 'shieldbattery_game_loader_max_estimated_latency_seconds',
    labelNames: ['game_source'],
    help: 'Maximum latency between a pair of peers in a game in seconds',
    buckets: linearBuckets(0.01, 0.03, 12),
  })
  // TODO(tec27): Add a metric for the chosen turn rate

  constructor(
    private publisher: TypedPublisher<GameLoaderEvent>,
    private activityRegistry: GameplayActivityRegistry,
  ) {}

  /**
   * Starts the process of loading a new game.
   *
   * @returns A promise which will resolve with the list of players if the game successfully loaded,
   *   or be rejected if the load failed.
   */
  loadGame({
    players,
    playerInfos,
    mapId,
    gameConfig,
    ratings,
    cancelToken,
  }: GameLoadRequest): Promise<Result<void, GameLoaderError>> {
    const gameLoaded = createDeferred<Result<void, GameLoaderError>>()

    this.gameLoadRequestsTotalMetric.labels(gameConfig.gameSource).inc()

    registerGame(mapId, gameConfig).then(
      ({ gameId, resultCodes }) => {
        const loadingCancelToken = cancelToken
          ? new MultiCancelToken(cancelToken)
          : new CancelToken()
        this.loadingGames = this.loadingGames.set(
          gameId,
          createLoadingData({
            gameSource: gameConfig.gameSource,
            players: Set(players),
            cancelToken: loadingCancelToken,
            deferred: gameLoaded,
          }),
        )
        this.doGameLoad({ gameId, mapId, gameConfig, resultCodes, playerInfos, ratings }).catch(
          err => {
            this.maybeCancelLoadingFromSystem(gameId, err)
          },
        )

        rejectOnTimeout(gameLoaded, GAME_LOAD_TIMEOUT).catch(() => {
          const loadingData = this.loadingGames.get(gameId)
          if (!loadingData) {
            // Something else must have already dealt with it
            return
          }

          // TODO(tec27): This isn't really "correct", as if one or more of the players failed to
          // connect to the host, all the players wouldn't be in "finishedPlayers", even though it
          // is almost certainly the non-connectors' fault. We need to track the actual state of
          // each player's game to determine this correctly
          const unloaded = loadingData.players
            .map(p => p.userId!)
            .subtract(loadingData.finishedPlayers)
            .toArray()
          this.maybeCancelLoadingFromSystem(
            gameId,
            new BaseGameLoaderError(GameLoadErrorType.Timeout, 'game load timed out', {
              data: {
                unloaded,
              },
            }),
          )
        })
      },
      err => {
        log.error({ err }, "couldn't register game with database")
        // NOTE(tec27): We haven't registered the game in `loadingGames` yet by this point so we
        // can't cancel it that way
        gameLoaded.resolve(
          Result.error(
            new BaseGameLoaderError(
              GameLoadErrorType.Internal,
              "Couldn't register game with database",
            ),
          ),
        )
      },
    )

    gameLoaded.catch(() => {
      this.gameLoadFailuresTotalMetric.labels(gameConfig.gameSource).inc()
    })

    return gameLoaded
  }

  /**
   * The game has successfully loaded for a specific player. Once the game is loaded for all
   * players, we clean up any remaining state to prevent it from being canceled.
   *
   * @returns whether the relevant game could be found
   */
  registerGameAsLoaded(gameId: string, playerId: SbUserId): boolean {
    if (!this.loadingGames.has(gameId)) {
      return false
    }

    let loadingData = this.loadingGames.get(gameId)!
    if (!loadingData.players.some(p => p.userId === playerId)) {
      return false
    }

    loadingData = loadingData.set('finishedPlayers', loadingData.finishedPlayers.add(playerId))
    this.loadingGames = this.loadingGames.set(gameId, loadingData)

    if (LoadingDatas.isAllFinished(loadingData)) {
      this.loadingGames = this.loadingGames.delete(gameId)
      loadingData.deferred.resolve(Result.ok())
    }

    this.gameLoadSuccessesTotalMetric.labels(loadingData.gameSource).inc()

    return true
  }

  /**
   * Cancels the loading state of the game if it was loading (no-op if it was not).
   *
   * @returns whether the relevant game could be found
   */
  maybeCancelLoading(gameId: string, playerId: SbUserId): boolean {
    if (!this.loadingGames.has(gameId)) {
      return false
    }

    const loadingData = this.loadingGames.get(gameId)!
    const loadingPlayer = loadingData.players.find(p => p.userId === playerId)
    if (!loadingPlayer) {
      return false
    }

    return this.maybeCancelLoadingFromSystem(
      gameId,
      new BaseGameLoaderError(GameLoadErrorType.PlayerFailed, `User ${playerId} failed to load`, {
        data: { userId: playerId },
      }),
    )
  }

  private maybeCancelLoadingFromSystem(gameId: string, reason: GameLoaderError) {
    if (!this.loadingGames.has(gameId)) {
      return false
    }

    const loadingData = this.loadingGames.get(gameId)!
    this.loadingGames = this.loadingGames.delete(gameId)
    loadingData.cancelToken.cancel()
    loadingData.deferred.resolve(Result.error(reason))

    Promise.all([deleteRecordForGame(gameId), deleteUserRecordsForGame(gameId)]).catch(err => {
      log.error({ err }, 'error removing game records for cancelled game')
    })

    return true
  }

  isLoading(gameId: string) {
    return this.loadingGames.has(gameId)
  }

  private async doGameLoad({
    gameId,
    mapId,
    gameConfig,
    resultCodes,
    playerInfos,
    ratings,
  }: {
    gameId: string
    mapId: string
    gameConfig: GameConfig
    resultCodes: Map<SbUserId, string>
    playerInfos: PlayerInfo[]
    ratings?: Array<[id: SbUserId, rating: number]>
  }): Promise<Result<void, GameLoaderError>> {
    if (!this.loadingGames.has(gameId)) {
      return Result.error(
        new BaseGameLoaderError(
          GameLoadErrorType.Internal,
          `tried to load a game that doesn't exist: ${gameId}`,
        ),
      )
    }

    const mapPromise = Result.try(() => getMapInfo([mapId]))

    const loadingData = this.loadingGames.get(gameId)!
    const { players, cancelToken } = loadingData
    const allUserIds = players.map(p => p.userId!).toArray()

    const usersResult = Result.try(() => findUsersById(allUserIds))

    const [activeClients, activeClientsError] = Result.all(
      ...allUserIds.map(userId => {
        const client = this.activityRegistry.getClientForUser(userId)
        if (!client) {
          return Result.error(
            new BaseGameLoaderError(
              GameLoadErrorType.PlayerFailed,
              'a player had no active client',
              {
                data: { userId },
              },
            ),
          )
        }
        return Result.ok(client)
      }),
    ).toTuple()

    if (activeClientsError) {
      return Result.error(activeClientsError)
    }

    const [users, usersError] = await usersResult.toTuple()
    if (usersError || users.length !== players.size) {
      return Result.error(
        new BaseGameLoaderError(GameLoadErrorType.Internal, "couldn't find all users in the game"),
      )
    }

    for (const client of activeClients) {
      client.subscribe(gameUserPath(gameId, client.userId), undefined, () => {
        this.maybeCancelLoadingFromSystem(
          gameId,
          new BaseGameLoaderError(
            GameLoadErrorType.PlayerFailed,
            'a player disconnected while loading',
            { data: { userId: client.userId } },
          ),
        )
      })
    }

    try {
      const rallyPointService = container.resolve(RallyPointService)
      const activityRegistry = container.resolve(GameplayActivityRegistry)

      const hasMultipleHumans = players.size > 1
      const pingPromise = !hasMultipleHumans
        ? Result.ok()
        : Result.all(
            ...players.map(p =>
              Result.try(
                () =>
                  rallyPointService.waitForPingResult(
                    activityRegistry.getClientForUser(p.userId!)!,
                  ),
                (error: unknown) =>
                  new BaseGameLoaderError(
                    GameLoadErrorType.PlayerFailed,
                    'a player failed to connect to a rally-point server',
                    { data: { userId: p.userId! }, cause: error },
                  ),
              ),
            ),
          )

      const pingResult = await pingPromise
      if (pingResult.isError()) {
        return Result.error(pingResult.error)
      }
      if (cancelToken.isCancelling) {
        return Result.error(
          new BaseGameLoaderError(GameLoadErrorType.Canceled, 'game load was canceled'),
        )
      }

      const [routes, routesError] = await (
        hasMultipleHumans ? Result.fromAsyncCatching(createRoutes(players)) : Result.ok([])
      ).toTuple()
      if (routesError) {
        return Result.error(
          new BaseGameLoaderError(GameLoadErrorType.Internal, 'error creating routes', {
            cause: routesError,
          }),
        )
      }
      if (cancelToken.isCancelling) {
        return Result.error(
          new BaseGameLoaderError(GameLoadErrorType.Canceled, 'game load was canceled'),
        )
      }

      let chosenTurnRate: BwTurnRate | 0 | undefined
      let chosenUserLatency: BwUserLatency | undefined

      if (
        gameConfig.gameSource === GameSource.Matchmaking ||
        gameConfig.gameSourceExtra?.turnRate === undefined
      ) {
        let maxEstimatedLatency = 0
        for (const route of routes) {
          if (route.estimatedLatency > maxEstimatedLatency) {
            maxEstimatedLatency = route.estimatedLatency
          }
        }

        this.maxEstimatedLatencyMetric
          .labels(loadingData.gameSource)
          .observe(maxEstimatedLatency / 1000)

        let availableTurnRates = MAX_LATENCIES_LOW.filter(
          ([_, latency]) => latency > maxEstimatedLatency,
        )
        if (availableTurnRates.length) {
          // Of the turn rates that work for this latency, pick the best one
          chosenTurnRate = availableTurnRates.at(-1)![0]
          chosenUserLatency = BwUserLatency.Low
        } else {
          // Fall back to a latency that will work for High latency
          availableTurnRates = MAX_LATENCIES_HIGH.filter(
            ([_, latency]) => latency > maxEstimatedLatency,
          )
          // Of the turn rates that work for this latency, pick the best one
          chosenTurnRate = availableTurnRates.length ? availableTurnRates.at(-1)![0] : 12
          chosenUserLatency = BwUserLatency.High
        }
      }

      const [maps, mapError] = await mapPromise.toTuple()
      if (mapError || !maps.length) {
        return Result.error(
          new BaseGameLoaderError(
            GameLoadErrorType.Internal,
            `Couldn't find map with ID ${mapId}`,
            {
              cause: mapError,
            },
          ),
        )
      }
      if (cancelToken.isCancelling) {
        return Result.error(
          new BaseGameLoaderError(GameLoadErrorType.Canceled, 'game load was canceled'),
        )
      }
      const [map] = maps

      const generalSetup = getGeneralGameSetup({
        gameConfig,
        playerInfos,
        users,
        map,
        gameId,
        ratings,
        seed: generateSeed(),
        turnRate: chosenTurnRate,
        userLatency: chosenUserLatency,
      })
      for (const player of players) {
        const userId = player.userId!
        this.publisher.publish(gameUserPath(gameId, userId), {
          type: 'setGameConfig',
          gameId,
          setup: {
            ...generalSetup,
            resultCode: resultCodes.get(userId)!,
          },
        })
      }

      // get a list of routes + player IDs per player, broadcast that to each player
      const routesByPlayer = routes.reduce((result, route) => {
        const {
          p1Slot,
          p2Slot,
          server,
          route: { routeId, p1Id, p2Id },
        } = route
        return result
          .update(p1Slot, List(), val =>
            val.push({ for: p2Slot.id, server, routeId, playerId: p1Id }),
          )
          .update(p2Slot, List(), val =>
            val.push({ for: p1Slot.id, server, routeId, playerId: p2Id }),
          )
      }, IMap<Slot, List<GameRoute>>())

      const debugRouteInfo = routes.map<GameRouteDebugInfo>(route => ({
        p1: route.p1,
        p2: route.p2,
        server: route.server.id,
        latency: route.estimatedLatency,
      }))
      Promise.resolve()
        .then(() => updateRouteDebugInfo(gameId, debugRouteInfo))
        .catch(err => {
          log.error({ err }, 'error updating route debug info')
        })

      for (const [player, routes] of routesByPlayer.entries()) {
        this.publisher.publish(gameUserPath(gameId, player.userId!), {
          type: 'setRoutes',
          gameId,
          routes: routes.toArray(),
        })
      }
      if (!hasMultipleHumans) {
        const human = players.first<Slot>().userId!
        this.publisher.publish(gameUserPath(gameId, human), {
          type: 'setRoutes',
          gameId,
          routes: [],
        })
      }

      if (cancelToken.isCancelling) {
        return Result.error(
          new BaseGameLoaderError(GameLoadErrorType.Canceled, 'game load was canceled'),
        )
      }

      for (const client of activeClients) {
        this.publisher.publish(gameUserPath(gameId, client.userId), {
          type: 'startWhenReady',
          gameId,
        })
      }

      // Delay the cleanup until after `startWhenReady` has been sent
      await Promise.resolve()
    } finally {
      for (const client of activeClients) {
        client.unsubscribe(urlPath`/gameLoader/${gameId}`)
      }
    }

    return Result.ok()
  }
}
