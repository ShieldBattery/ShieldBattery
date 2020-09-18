import { List, Map, Record, Set } from 'immutable'

import log from '../logging/logger'
import pickServer from '../rally-point/pick-server'
import pingRegistry from '../rally-point/ping-registry'
import routeCreator from '../rally-point/route-creator'
import CancelToken from '../../../common/async/cancel-token'
import createDeferred from '../../../common/async/deferred'
import rejectOnTimeout from '../../../common/async/reject-on-timeout'
import { registerGame } from './registration'
import { deleteRecordForGame } from '../models/games'
import { deleteUserRecordsForGame } from '../models/games-users'

const GAME_LOAD_TIMEOUT = 30 * 1000

function generateSeed() {
  // BWChart and some other replay sites/libraries utilize the random seed as the date the game was
  // played, so we match BW's random seed method (time()) here
  return (Date.now() / 1000) | 0
}

function createRoutes(players) {
  // Generate all the pairings of players to figure out the routes we need
  const matchGen = []
  let rest = players
  while (!rest.isEmpty()) {
    const first = rest.first()
    rest = rest.rest()
    if (!rest.isEmpty()) {
      matchGen.push([first, rest])
    }
  }
  const needRoutes = matchGen.reduce((result, [p1, players]) => {
    players.forEach(p2 => result.push([p1, p2]))
    return result
  }, [])
  const pingsByPlayer = new Map(players.map(player => [player, pingRegistry.getPings(player.name)]))

  const routesToCreate = needRoutes.map(([p1, p2]) => ({
    p1,
    p2,
    server: pickServer(pingsByPlayer.get(p1), pingsByPlayer.get(p2)),
  }))

  return Promise.all(
    routesToCreate.map(({ p1, p2, server }) =>
      server === -1
        ? Promise.reject(new Error('No server match found'))
        : routeCreator.createRoute(pingRegistry.servers[server]).then(result => ({
            p1,
            p2,
            server: pingRegistry.servers[server],
            result,
          })),
    ),
  )
}

const LoadingData = new Record({
  players: new Set(),
  finishedPlayers: new Set(),
  cancelToken: null,
  deferred: null,
})

export const LoadingDatas = {
  isAllFinished(loadingData) {
    return loadingData.players.every(p => loadingData.finishedPlayers.has(p.id))
  },
}

export class GameLoader {
  constructor() {
    this.loadingGames = new Map()
  }

  /**
   * Starts the process of loading a new game.
   *
   * @param players A list of players that should be created as human (or observer) type slots. At
   *   least one player should be present for things to work properly.
   * @param mapId The ID of the map that the game will be played on
   * @param gameSource A string representing the source of the game, e.g. 'MATCHMAKING' or 'LOBBY'
   * @param gameConfig an object describing the configuration of the game in the format:
   *   `{ gameType, gameSubType, teams: [ [team1Players], [team2Players], ...] }`
   *   For games that begin teamless, all players may be on a single team. Entries in the team lists
   *   are in the format `{ name, race = (p,r,t,z), isComputer }`.
   * @param onGameSetup An optional callback({ gameId, seed }) that will be called when the game
   *   setup info has been sent to clients
   * @param onRoutesSet An optional callback(playerName, routes, gameId) that will be called for
   *   each player when their routes to all other players have been set up and are ready to be used.
   *
   * @returns A promise which will resolve with the list of players if the game successfully loaded,
   *   or be rejected if the load failed.
   */
  loadGame({ players, mapId, gameSource, gameConfig, onGameSetup, onRoutesSet }) {
    const gameLoaded = createDeferred()

    registerGame(mapId, gameSource, gameConfig)
      .then(({ gameId, resultCodes }) => {
        const cancelToken = new CancelToken()
        this.loadingGames = this.loadingGames.set(
          gameId,
          new LoadingData({
            players: new Set(players),
            cancelToken,
            deferred: gameLoaded,
          }),
        )
        this._doGameLoad(gameId, onGameSetup, onRoutesSet).catch(() => {
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
  registerGameAsLoaded(gameId, playerName) {
    if (!this.loadingGames.has(gameId)) {
      return
    }

    let loadingData = this.loadingGames.get(gameId)
    const player = loadingData.players.find(p => p.name === playerName)
    loadingData = loadingData.set('finishedPlayers', loadingData.finishedPlayers.add(player.id))
    this.loadingGames = this.loadingGames.set(gameId, loadingData)

    if (LoadingDatas.isAllFinished(loadingData)) {
      // TODO(tec27): register this game in the DB for accepting results
      this.loadingGames = this.loadingGames.delete(gameId)
      loadingData.deferred.resolve()
    }
  }

  // Cancels the loading state of the game if it was loading (no-op if it was not)
  maybeCancelLoading(gameId) {
    if (!this.loadingGames.has(gameId)) {
      return
    }

    const loadingData = this.loadingGames.get(gameId)
    this.loadingGames = this.loadingGames.delete(gameId)
    loadingData.cancelToken.cancel()
    loadingData.deferred.reject(new Error('Game loading cancelled'))

    Promise.all([deleteRecordForGame(gameId), deleteUserRecordsForGame(gameId)]).catch(err => {
      log.error({ err }, 'error removing game records for cancelled gamed')
    })
  }

  isLoading(gameId) {
    return this.loadingGames.has(gameId)
  }

  async _doGameLoad(gameId, onGameSetup, onRoutesSet) {
    if (!this.loadingGames.has(gameId)) {
      return
    }

    const loadingData = this.loadingGames.get(gameId)
    const { players, cancelToken } = loadingData

    const onGameSetupResult = onGameSetup
      ? onGameSetup({ gameId, seed: generateSeed() })
      : Promise.resolve()

    const hasMultipleHumans = players.size > 1
    const pingPromise = !hasMultipleHumans
      ? Promise.resolve()
      : Promise.all(players.map(p => pingRegistry.waitForPingResult(p.name)))

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
        .update(p1, new List(), val => val.push({ for: p2.id, server, routeId, playerId: p1Id }))
        .update(p2, new List(), val => val.push({ for: p1.id, server, routeId, playerId: p2Id }))
    }, new Map())

    for (const [player, routes] of routesByPlayer.entries()) {
      if (onRoutesSet) {
        onRoutesSet(player.name, routes, gameId)
      }
    }
    if (!hasMultipleHumans) {
      if (onRoutesSet) {
        onRoutesSet(players.first().name, [], gameId)
      }
    }

    await onGameSetupResult
    cancelToken.throwIfCancelling()
  }
}

export default new GameLoader()
