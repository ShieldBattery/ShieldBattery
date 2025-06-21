import { Map as IMap, List, Record, Set } from 'immutable'
import { Counter, Histogram, linearBuckets } from 'prom-client'
import { container, singleton } from 'tsyringe'
import CancelToken, { MultiCancelToken } from '../../../common/async/cancel-token'
import createDeferred, { Deferred } from '../../../common/async/deferred'
import rejectOnTimeout from '../../../common/async/reject-on-timeout'
import { GameConfig, GameSource } from '../../../common/games/configuration'
import { GameRoute } from '../../../common/games/game-launch-config'
import { GameLoaderEvent } from '../../../common/games/game-loader-network'
import { GameRouteDebugInfo } from '../../../common/games/games'
import { Slot } from '../../../common/lobbies/slot'
import { BwTurnRate, BwUserLatency, turnRateToMaxLatency } from '../../../common/network'
import { urlPath } from '../../../common/urls'
import { SbUserId } from '../../../common/users/sb-user-id'
import { CodedError } from '../errors/coded-error'
import log from '../logging/logger'
import { deleteUserRecordsForGame } from '../models/games-users'
import { RallyPointRouteInfo, RallyPointService } from '../rally-point/rally-point-service'
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
  PlayerFailed = 'playerFailed',
}

interface GameLoadErrorTypeToData {
  [GameLoadErrorType.PlayerFailed]: {
    userId: SbUserId
  }
}

export class GameLoaderError<T extends GameLoadErrorType> extends CodedError<
  T,
  GameLoadErrorTypeToData[T]
> {}

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
  finishedPlayers: Set<string>(),
  cancelToken: null as unknown as CancelToken,
  deferred: null as unknown as Deferred<void>,
})

type LoadingData = ReturnType<typeof createLoadingData>

const LoadingDatas = {
  isAllFinished(loadingData: LoadingData) {
    return loadingData.players.every(p => loadingData.finishedPlayers.has(p.id))
  },
}

export interface GameSetupGameInfo {
  gameId: string
  seed: number
  turnRate?: BwTurnRate | 0
  userLatency?: BwUserLatency
  useLegacyLimits?: boolean
}

export type OnGameSetupFunc = (
  gameInfo: GameSetupGameInfo,
  /** Map of user ID -> code for submitting the game results */
  resultCodes: Map<SbUserId, string>,
) => void | Promise<void>

export type OnRoutesSetFunc = (playerName: string, routes: GameRoute[], gameId: string) => void

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
   * The ID of the map that the game will be played on.
   */
  mapId: string
  /**
   * Configuration info for the game.
   */
  gameConfig: GameConfig
  /** A `CancelToken` that can be used to cancel the loading process midway through. */
  cancelToken: CancelToken
  /**
   * An optional callback for when the game setup info has been sent to clients.
   */
  onGameSetup?: OnGameSetupFunc
}

function gameUserPath(gameId: string, userId: SbUserId) {
  return urlPath`/gameLoader/${gameId}/${userId}`
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
  // TODO(tec27): Add a metric for the chosen turn rate if we turn the static turnrate feature on

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
  loadGame({ players, mapId, gameConfig, cancelToken, onGameSetup }: GameLoadRequest) {
    const gameLoaded = createDeferred<void>()

    this.gameLoadRequestsTotalMetric.labels(gameConfig.gameSource).inc()

    registerGame(mapId, gameConfig)
      .then(({ gameId, resultCodes }) => {
        const loadingCancelToken = new MultiCancelToken(cancelToken)
        this.loadingGames = this.loadingGames.set(
          gameId,
          createLoadingData({
            gameSource: gameConfig.gameSource,
            players: Set(players),
            cancelToken: loadingCancelToken,
            deferred: gameLoaded,
          }),
        )
        this.doGameLoad(gameId, gameConfig, resultCodes, onGameSetup).catch(err => {
          this.maybeCancelLoadingFromSystem(gameId, err)
        })

        rejectOnTimeout(gameLoaded, GAME_LOAD_TIMEOUT).catch(err => {
          this.maybeCancelLoadingFromSystem(gameId, err)
        })
      })
      .catch(err => {
        log.error({ err }, "couldn't register game with database")
        // NOTE(tec27): We haven't registered the game in `loadingGames` yet by this point so we
        // can't cancel it that way
        gameLoaded.reject(new Error("Couldn't register game with database"))
      })

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
  registerGameAsLoaded(gameId: string, playerName: string): boolean {
    if (!this.loadingGames.has(gameId)) {
      return false
    }

    let loadingData = this.loadingGames.get(gameId)!
    const player = loadingData.players.find(p => p.name === playerName)!
    loadingData = loadingData.set('finishedPlayers', loadingData.finishedPlayers.add(player.id))
    this.loadingGames = this.loadingGames.set(gameId, loadingData)

    if (LoadingDatas.isAllFinished(loadingData)) {
      this.loadingGames = this.loadingGames.delete(gameId)
      loadingData.deferred.resolve()
    }

    this.gameLoadSuccessesTotalMetric.labels(loadingData.gameSource).inc()

    return true
  }

  /**
   * Cancels the loading state of the game if it was loading (no-op if it was not).
   *
   * @returns whether the relevant game could be found
   */
  maybeCancelLoading(gameId: string, playerName: string): boolean {
    if (!this.loadingGames.has(gameId)) {
      return false
    }

    const loadingData = this.loadingGames.get(gameId)!
    const loadingPlayer = loadingData.players.find(p => p.name === playerName)
    if (!loadingPlayer) {
      return false
    }

    // TODO(tec27): Make some error type that lets us pass this info back to users
    return this.maybeCancelLoadingFromSystem(
      gameId,
      new GameLoaderError(GameLoadErrorType.PlayerFailed, `${playerName} failed to load`, {
        data: { userId: loadingPlayer.userId },
      }),
    )
  }

  private maybeCancelLoadingFromSystem(gameId: string, reason: Error) {
    if (!this.loadingGames.has(gameId)) {
      return false
    }

    const loadingData = this.loadingGames.get(gameId)!
    this.loadingGames = this.loadingGames.delete(gameId)
    loadingData.cancelToken.cancel()
    loadingData.deferred.reject(reason)

    Promise.all([deleteRecordForGame(gameId), deleteUserRecordsForGame(gameId)]).catch(err => {
      log.error({ err }, 'error removing game records for cancelled game')
    })

    return true
  }

  isLoading(gameId: string) {
    return this.loadingGames.has(gameId)
  }

  private async doGameLoad(
    gameId: string,
    gameConfig: GameConfig,
    resultCodes: Map<SbUserId, string>,
    onGameSetup?: OnGameSetupFunc,
  ) {
    if (!this.loadingGames.has(gameId)) {
      throw new Error(`tried to load a game that doesn't exist: ${gameId}`)
    }

    const activeClients = resultCodes.keys().map(userId => {
      const client = this.activityRegistry.getClientForUser(userId)
      if (!client) {
        throw new GameLoaderError(GameLoadErrorType.PlayerFailed, `A player had no active client`, {
          data: { userId },
        })
      }
      return client
    })

    const loadingData = this.loadingGames.get(gameId)!
    const { players, cancelToken } = loadingData

    for (const client of activeClients) {
      client.subscribe(gameUserPath(gameId, client.userId), undefined, () => {
        cancelToken.cancel()
      })
    }

    try {
      const rallyPointService = container.resolve(RallyPointService)
      const activityRegistry = container.resolve(GameplayActivityRegistry)

      const hasMultipleHumans = players.size > 1
      const pingPromise = !hasMultipleHumans
        ? Promise.resolve()
        : Promise.all(
            players.map(p =>
              rallyPointService.waitForPingResult(activityRegistry.getClientForUser(p.userId)!),
            ),
          )

      await pingPromise
      cancelToken.throwIfCancelling()

      const routes = hasMultipleHumans ? await createRoutes(players) : []
      cancelToken.throwIfCancelling()

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

      const onGameSetupResult = onGameSetup
        ? onGameSetup(
            {
              gameId,
              seed: generateSeed(),
              turnRate: chosenTurnRate,
              useLegacyLimits:
                gameConfig.gameSource === GameSource.Lobby
                  ? gameConfig.gameSourceExtra?.useLegacyLimits
                  : undefined,
              userLatency: chosenUserLatency,
            },
            resultCodes,
          )
        : Promise.resolve()

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
        this.publisher.publish(gameUserPath(gameId, player.userId), {
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

      await onGameSetupResult
      cancelToken.throwIfCancelling()
    } finally {
      for (const client of activeClients) {
        client.unsubscribe(urlPath`/gameLoader/${gameId}`)
      }
    }
  }
}
