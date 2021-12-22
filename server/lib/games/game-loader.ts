import { List, Map as IMap, Record, Set } from 'immutable'
import { container } from 'tsyringe'
import CancelToken, { MultiCancelToken } from '../../../common/async/cancel-token'
import createDeferred, { Deferred } from '../../../common/async/deferred'
import rejectOnTimeout from '../../../common/async/reject-on-timeout'
import { GameRoute } from '../../../common/game-launch-config'
import { GameConfig } from '../../../common/games/configuration'
import { GameRouteDebugInfo } from '../../../common/games/games'
import { Slot } from '../../../common/lobbies/slot'
import { BwTurnRate, BwUserLatency, turnRateToMaxLatency } from '../../../common/network'
import { SbUserId } from '../../../common/users/sb-user'
import { CodedError } from '../errors/coded-error'
import log from '../logging/logger'
import { deleteUserRecordsForGame } from '../models/games-users'
import { RallyPointRouteInfo, RallyPointService } from '../rally-point/rally-point-service'
import { deleteRecordForGame, updateRouteDebugInfo } from './game-models'
import { GameplayActivityRegistry } from './gameplay-activity-registry'
import { registerGame } from './registration'

const GAME_LOAD_TIMEOUT = 60 * 1000

// NOTE(tec27): It's important that these are sorted low -> high
const POTENTIAL_TURN_RATES: ReadonlyArray<BwTurnRate> = [12, 14, 16, 20, 24]
/**
 * Entries of turn rate -> the max latency that is allowed to auto-pick that turn rate. These values
 * are chosen to be a bit conservative, and ensure that even if there is somewhat frequent packet
 * loss, the ingame settings could be used to get things mostly playable. (This is a stop-gap
 * measure, longer-term our netcode should be able to adjust on the fly.)
 */
const MAX_LATENCIES: ReadonlyArray<[turnRate: BwTurnRate, maxLatency: number]> =
  POTENTIAL_TURN_RATES.map(turnRate => [
    turnRate,
    turnRateToMaxLatency(turnRate, BwUserLatency.ExtraHigh) / 2,
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
> {
  constructor(code: T, message: string, data: GameLoadErrorTypeToData[T]) {
    super(code, message, data)
  }
}

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
  const needRoutes = matchGen.reduce((result, [p1, players]) => {
    players.forEach(p2 => result.push([p1, p2]))
    return result
  }, [] as Array<[Slot, Slot]>)

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

export type OnGameSetupFunc = (
  gameInfo: { gameId: string; seed: number; turnRate?: BwTurnRate },
  /** Map of user ID -> code for submitting the game results */
  resultCodes: Map<SbUserId, string>,
) => void

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
  /**
   * An optional callback that will be called for each player when their routes to all other
   * players have been set up and are ready to be used.
   */
  onRoutesSet?: OnRoutesSetFunc
}

export class GameLoader {
  // Maps game id -> loading data
  private loadingGames = IMap<string, LoadingData>()

  /**
   * Starts the process of loading a new game.
   *
   * @returns A promise which will resolve with the list of players if the game successfully loaded,
   *   or be rejected if the load failed.
   */
  loadGame({ players, mapId, gameConfig, cancelToken, onGameSetup, onRoutesSet }: GameLoadRequest) {
    const gameLoaded = createDeferred<void>()

    registerGame(mapId, gameConfig)
      .then(({ gameId, resultCodes }) => {
        const loadingCancelToken = new MultiCancelToken(cancelToken)
        this.loadingGames = this.loadingGames.set(
          gameId,
          createLoadingData({
            players: Set(players),
            cancelToken: loadingCancelToken,
            deferred: gameLoaded,
          }),
        )
        this.doGameLoad(gameId, resultCodes, onGameSetup, onRoutesSet).catch(err => {
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
        userId: loadingPlayer.userId,
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
    resultCodes: Map<SbUserId, string>,
    onGameSetup?: OnGameSetupFunc,
    onRoutesSet?: OnRoutesSetFunc,
  ) {
    if (!this.loadingGames.has(gameId)) {
      throw new Error(`tried to load a game that doesn't exist: ${gameId}`)
    }

    const loadingData = this.loadingGames.get(gameId)!
    const { players, cancelToken } = loadingData

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

    let maxEstimatedLatency = 0
    for (const route of routes) {
      if (route.estimatedLatency > maxEstimatedLatency) {
        maxEstimatedLatency = route.estimatedLatency
      }
    }
    const availableTurnRates = MAX_LATENCIES.filter(([_, latency]) => latency > maxEstimatedLatency)
    // Of the turn rates that work for this latency, pick the best one
    const chosenTurnRate: BwTurnRate = availableTurnRates.length
      ? availableTurnRates.at(-1)![0]
      : 12

    const onGameSetupResult = onGameSetup
      ? onGameSetup({ gameId, seed: generateSeed(), turnRate: chosenTurnRate }, resultCodes)
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
      if (onRoutesSet) {
        onRoutesSet(player.name!, routes.toArray(), gameId)
      }
    }
    if (!hasMultipleHumans) {
      if (onRoutesSet) {
        onRoutesSet(players.first<Slot>().name!, [], gameId)
      }
    }

    await onGameSetupResult
    cancelToken.throwIfCancelling()
  }
}

export default new GameLoader()
