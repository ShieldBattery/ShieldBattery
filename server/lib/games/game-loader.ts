import { List, Map as IMap, Record, Set } from 'immutable'
import CancelToken from '../../../common/async/cancel-token'
import createDeferred, { Deferred } from '../../../common/async/deferred'
import rejectOnTimeout from '../../../common/async/reject-on-timeout'
import { GameRoute } from '../../../common/game-config'
import { Slot } from '../lobbies/slot'
import log from '../logging/logger'
import { deleteRecordForGame } from '../models/games'
import { deleteUserRecordsForGame } from '../models/games-users'
import pickServer from '../rally-point/pick-server'
import pingRegistry, { RallyPointServer } from '../rally-point/ping-registry'
import routeCreator from '../rally-point/route-creator'
import { GameConfigPlayerName, GameSource } from './configuration'
import { registerGame } from './registration'

const GAME_LOAD_TIMEOUT = 30 * 1000

function generateSeed() {
  // BWChart and some other replay sites/libraries utilize the random seed as the date the game was
  // played, so we match BW's random seed method (time()) here
  return (Date.now() / 1000) | 0
}

interface RouteResult {
  p1: Slot
  p2: Slot
  server: RallyPointServer
  result: {
    p1Id: string
    p2Id: string
    routeId: string
  }
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
  const pingsByPlayer = IMap(players.map(player => [player, pingRegistry.getPings(player.name!)]))

  const routesToCreate = needRoutes.map(([p1, p2]) => ({
    p1,
    p2,
    server: pickServer(pingsByPlayer.get(p1), pingsByPlayer.get(p2)),
  }))

  return Promise.all(
    routesToCreate.map(({ p1, p2, server }) =>
      server === -1
        ? Promise.reject(new Error('No server match found'))
        : routeCreator
            .createRoute(pingRegistry.servers[server])
            .then((result: { p1Id: string; p2Id: string; routeId: string }) => ({
              p1,
              p2,
              server: pingRegistry.servers[server],
              result,
            })),
    ),
  )
}

const createLoadingData = Record({
  players: Set<Slot>(),
  finishedPlayers: Set<string>(),
  cancelToken: (null as unknown) as CancelToken,
  deferred: (null as unknown) as Deferred<void>,
})

type LoadingData = ReturnType<typeof createLoadingData>

const LoadingDatas = {
  isAllFinished(loadingData: LoadingData) {
    return loadingData.players.every(p => loadingData.finishedPlayers.has(p.id))
  },
}

export type OnGameSetupFunc = (
  gameInfo: { gameId: string; seed: number },
  /** Map of username -> code for submitting the game results */
  resultCodes: Map<string, string>,
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
   * The source of the game's creation/launch, e.g. 'MATCHMAKING'
   */
  gameSource: GameSource
  // TODO(tec27): Probably this should be some type of structured data instead of a string tbh
  /**
   * An optional string of extra information about the source of the game.
   */
  gameSourceExtra?: string
  /**
   * Configuration info for the game.
   */
  gameConfig: {
    // TODO(tec27): this could be more limiting/specific
    /** A string describing the game type. */
    gameType: string
    /** A number describing the game sub-type (if necessary). */
    gameSubType: number
    /**
     * An array with one entry per team, each entry being an array of players on that team. If the
     * game has no teams, this will be an array containing a single array of players.
     */
    teams: GameConfigPlayerName[][]
  }
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
  loadGame({
    players,
    mapId,
    gameSource,
    gameSourceExtra,
    gameConfig,
    onGameSetup,
    onRoutesSet,
  }: GameLoadRequest) {
    const gameLoaded = createDeferred<void>()

    registerGame(mapId, gameSource, gameSourceExtra, gameConfig)
      .then(({ gameId, resultCodes }) => {
        const cancelToken = new CancelToken()
        this.loadingGames = this.loadingGames.set(
          gameId,
          createLoadingData({
            players: Set(players),
            cancelToken,
            deferred: gameLoaded,
          }),
        )
        this.doGameLoad(gameId, resultCodes, onGameSetup, onRoutesSet).catch(() => {
          this.maybeCancelLoading(gameId)
        })

        rejectOnTimeout(gameLoaded, GAME_LOAD_TIMEOUT).catch(() => {
          this.maybeCancelLoading(gameId)
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

  // The game has successfully loaded for a specific player; once the game is loaded for all
  // players, we register it in the DB for accepting results.
  registerGameAsLoaded(gameId: string, playerName: string) {
    if (!this.loadingGames.has(gameId)) {
      return
    }

    let loadingData = this.loadingGames.get(gameId)!
    const player = loadingData.players.find(p => p.name === playerName)!
    loadingData = loadingData.set('finishedPlayers', loadingData.finishedPlayers.add(player.id))
    this.loadingGames = this.loadingGames.set(gameId, loadingData)

    if (LoadingDatas.isAllFinished(loadingData)) {
      // TODO(tec27): register this game in the DB for accepting results
      this.loadingGames = this.loadingGames.delete(gameId)
      loadingData.deferred.resolve()
    }
  }

  /** Cancels the loading state of the game if it was loading (no-op if it was not). */
  maybeCancelLoading(gameId: string) {
    if (!this.loadingGames.has(gameId)) {
      return
    }

    const loadingData = this.loadingGames.get(gameId)!
    this.loadingGames = this.loadingGames.delete(gameId)
    loadingData.cancelToken.cancel()
    loadingData.deferred.reject(new Error('Game loading cancelled'))

    Promise.all([deleteRecordForGame(gameId), deleteUserRecordsForGame(gameId)]).catch(err => {
      log.error({ err }, 'error removing game records for cancelled gamed')
    })
  }

  isLoading(gameId: string) {
    return this.loadingGames.has(gameId)
  }

  private async doGameLoad(
    gameId: string,
    resultCodes: Map<string, string>,
    onGameSetup?: OnGameSetupFunc,
    onRoutesSet?: OnRoutesSetFunc,
  ) {
    if (!this.loadingGames.has(gameId)) {
      return
    }

    const loadingData = this.loadingGames.get(gameId)!
    const { players, cancelToken } = loadingData

    const onGameSetupResult = onGameSetup
      ? onGameSetup({ gameId, seed: generateSeed() }, resultCodes)
      : Promise.resolve()

    const hasMultipleHumans = players.size > 1
    const pingPromise = !hasMultipleHumans
      ? Promise.resolve()
      : Promise.all(players.map(p => pingRegistry.waitForPingResult(p.name!)))

    await pingPromise
    cancelToken.throwIfCancelling()

    const routes = hasMultipleHumans ? await createRoutes(players) : []
    cancelToken.throwIfCancelling()

    // get a list of routes + player IDs per player, broadcast that to each player
    const routesByPlayer = routes.reduce((result, route) => {
      const {
        p1,
        p2,
        server,
        result: { routeId, p1Id, p2Id },
      } = route
      return result
        .update(p1, List(), val => val.push({ for: p2.id, server, routeId, playerId: p1Id }))
        .update(p2, List(), val => val.push({ for: p1.id, server, routeId, playerId: p2Id }))
    }, IMap<Slot, List<GameRoute>>())

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
