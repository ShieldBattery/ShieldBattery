import { List, Map, Range, Record, Set } from 'immutable'
import errors from 'http-errors'
import { Mount, Api, registerApiRoutes } from '../websockets/api-decorators'
import validateBody from '../websockets/validate-body'
import activityRegistry from '../games/gameplay-activity-registry'
import gameLoader from '../games/game-loader'
import { createHuman } from '../lobbies/slot'
import { getMapInfo } from '../models/maps'
import { getCurrentMapPool } from '../models/matchmaking-map-pools'
import { Interval, TimedMatchmaker } from '../matchmaking/matchmaker'
import MatchAcceptor from '../matchmaking/match-acceptor'
import matchmakingStatusInstance from '../matchmaking/matchmaking-status-instance'
import createDeferred from '../../../common/async/deferred'
import { MATCHMAKING_ACCEPT_MATCH_TIME, validRace } from '../../../common/constants'
import { MatchmakingType, isValidMatchmakingType } from '../../../common/matchmaking'
import { MATCHMAKING } from '../../../common/flags'
import swallowNonBuiltins from '../../../common/async/swallow-non-builtins'

const Player = new Record({
  id: null,
  name: null,
  rating: -1,
  interval: null,
  race: null,
  useAlternateRace: false,
  alternateRace: null,
  preferredMaps: new Set(),
})

const Match = new Record({
  type: null,
  players: new List(),
})

const QueueEntry = new Record({
  username: null,
  type: null,
})

const Timers = new Record({
  mapSelectionTimer: null,
  countdownTimer: null,
})

const getRandomInt = max => Math.floor(Math.random() * Math.floor(max))

// How often to run the matchmaker 'find match' process
const MATCHMAKING_INTERVAL = 7500
// Extra time that is added to the matchmaking accept time to account for latency in getting
// messages back and forth from clients
const ACCEPT_MATCH_LATENCY = 2000
const MOUNT_BASE = '/matchmaking'

/**
 * Selects a map for the given players and matchmaking type, based on the players' stored
 * matchmaking preferences and the current map pool.
 *
 * @returns an object with `{ mapsByPlayer, preferredMaps, randomMaps, chosenMap }` describing the
 *   maps that were used to make the selection, as well as the actual selection.
 */
async function pickMap(matchmakingType, players) {
  const currentMapPool = await getCurrentMapPool(matchmakingType)
  if (!currentMapPool) {
    throw new Error('invalid map pool')
  }

  // The algorithm for selecting maps is:
  // 1) All player selections are collected and only unique ones are kept
  // 2) If there are less than 4 maps after #1, we fill the rest of the list
  //    with random map selections from the pool that are *also* unique
  // 3) We pick 1 random map from this 4 map pool as the chosen one
  //
  // This means that we are guaranteed to have 4 unique maps to select from each
  // time, and that even if 2 particular maps are extremely popular among
  // players, they will still have to know how to play on the entire pool. It
  // also means that players that learn "rare" maps will have an advantage
  // during this selection process (there is a higher chance their map will
  // not be replaced with a random one).

  const mapPool = Set(currentMapPool.maps)
  let preferredMapIds = Set()
  let mapIdsByPlayer = Map()

  for (const p of players) {
    const available = p.preferredMaps.intersect(mapPool)
    preferredMapIds = preferredMapIds.concat(available)
    mapIdsByPlayer = mapIdsByPlayer.set(p.id, available)
  }

  const randomMapIds = []
  Range(preferredMapIds.size, 4).forEach(() => {
    const availableMaps = mapPool.subtract(preferredMapIds.concat(randomMapIds))
    const randomMap = availableMaps.toList().get(getRandomInt(availableMaps.size))
    randomMapIds.push(randomMap)
  })

  const [preferredMaps, randomMaps] = await Promise.all([
    getMapInfo(preferredMapIds.toJS()),
    getMapInfo(randomMapIds),
  ])
  if (preferredMapIds.size + randomMapIds.length !== preferredMaps.length + randomMaps.length) {
    throw new Error('no maps found')
  }

  const mapsByPlayer = mapIdsByPlayer
    .map(mapIds => mapIds.map(id => preferredMaps.find(m => m.id === id)))
    .toJS()

  const chosenMap = [...preferredMaps, ...randomMaps][
    getRandomInt(preferredMaps.length + randomMaps.length)
  ]

  return { mapsByPlayer, preferredMaps, randomMaps, chosenMap }
}

@Mount(MOUNT_BASE)
export class MatchmakingApi {
  constructor(nydus, userSockets, clientSockets) {
    this.nydus = nydus
    this.userSockets = userSockets
    this.clientSockets = clientSockets

    this.matchmakers = new Map(
      Object.values(MatchmakingType).map(type => [
        type,
        new TimedMatchmaker(MATCHMAKING_INTERVAL, this.matchmakerDelegate.onMatchFound),
      ]),
    )
    this.acceptor = new MatchAcceptor(
      MATCHMAKING_ACCEPT_MATCH_TIME + ACCEPT_MATCH_LATENCY,
      this.matchAcceptorDelegate,
    )

    this.queueEntries = new Map()
    this.clientTimers = new Map()
  }

  matchmakerDelegate = {
    onMatchFound: (player, opponent) => {
      const { type } = this.queueEntries.get(player.name)
      const matchInfo = new Match({
        type,
        players: new List([player, opponent]),
      })
      this.acceptor.addMatch(matchInfo, [
        activityRegistry.getClientForUser(player.name),
        activityRegistry.getClientForUser(opponent.name),
      ])

      this._publishToActiveClient(player.name, {
        type: 'matchFound',
        matchmakingType: type,
        numPlayers: 2,
      })
      this._publishToActiveClient(opponent.name, {
        type: 'matchFound',
        matchmakingType: type,
        numPlayers: 2,
      })
    },
  }

  matchAcceptorDelegate = {
    onAcceptProgress: (matchInfo, total, accepted) => {
      for (const player of matchInfo.players) {
        this._publishToActiveClient(player.name, {
          type: 'playerAccepted',
          acceptedPlayers: accepted,
        })
      }
    },
    onAccepted: async (matchInfo, clients) => {
      this.queueEntries = this.queueEntries.withMutations(map => {
        for (const client of clients) {
          map.delete(client.name)
        }
      })

      let slots
      const players = matchInfo.players
      const playersHaveSameRace = players.every(p => p.race === players.first().race)
      if (playersHaveSameRace && players.every(p => p.useAlternateRace === true)) {
        // All players have the same race and want to use an alternate race; select randomly one
        // player to use the alternate race and everyone else their main race. This is only done for
        // the first player, as the whole concept of the alternate race doesn't make much sense when
        // there are more than two players.
        const randomPlayerIndex = getRandomInt(players.size)
        slots = players.map((p, i) =>
          i === randomPlayerIndex
            ? createHuman(p.name, p.alternateRace)
            : createHuman(p.name, p.race),
        )
      } else if (playersHaveSameRace && players.some(p => p.useAlternateRace === true)) {
        // All players have the same race, but only some of them are choosing to use an alternate
        // race; find the first player who wants to use the alternate race and have everyone else
        // use their main. Again, this is only done for the first player.
        const useAlternateRacePlayer = players.find(p => p.useAlternateRace === true)
        slots = players.map(p =>
          p.id === useAlternateRacePlayer.id
            ? createHuman(p.name, p.alternateRace)
            : createHuman(p.name, p.race),
        )
      } else {
        // All players have different race or don't want to use alternate race; nothing special to
        // do here.
        slots = players.map(p => createHuman(p.name, p.race))
      }

      const { mapsByPlayer, preferredMaps, randomMaps, chosenMap } = await pickMap(
        matchInfo.type,
        matchInfo.players,
      )

      const gameConfig = {
        // TODO(tec27): This will need to be adjusted for team matchmaking
        gameType: 'oneVOne',
        gameSubType: 0,
        teams: [
          slots
            .map(s => ({
              name: s.name,
              race: s.race,
              isComputer: s.type === 'computer' || s.type === 'umsComputer',
            }))
            .toArray(),
        ],
      }

      const gameLoaded = gameLoader.loadGame({
        players: slots,
        mapId: chosenMap.id,
        gameSource: 'MATCHMAKING',
        gameSourceExtra: matchInfo.type,
        gameConfig,
        onGameSetup: (setup, resultCodes) =>
          this.gameLoaderDelegate.onGameSetup({
            matchInfo,
            clients,
            slots,
            setup,
            resultCodes,
            mapsByPlayer,
            preferredMaps,
            randomMaps,
            chosenMap,
          }),
        onRoutesSet: (playerName, routes, gameId) =>
          this.gameLoaderDelegate.onRoutesSet(clients, playerName, routes, gameId),
      })

      await gameLoaded
      this.gameLoaderDelegate.onGameLoaded(clients)
    },
    onDeclined: (matchInfo, requeueClients, kickClients) => {
      this.queueEntries = this.queueEntries.withMutations(map => {
        for (const client of kickClients) {
          map.delete(client)
          this._publishToActiveClient(client.name, {
            type: 'acceptTimeout',
          })
          this._unregisterActivity(client)
        }
      })

      for (const client of requeueClients) {
        const player = matchInfo.players.find(p => p.name === client.name)
        this.matchmakers.get(matchInfo.type).addToQueue(player)
        this._publishToActiveClient(client.name, {
          type: 'requeue',
        })
      }
    },
    onError: (err, clients) => {
      for (const client of clients) {
        this._publishToActiveClient(client.name, {
          type: 'cancelLoading',
          // TODO(tec27): We probably shouldn't be blindly sending error messages to clients
          reason: err && err.message,
        })
        this._unregisterActivity(client)
      }
    },
  }

  gameLoaderDelegate = {
    onGameSetup: async ({
      matchInfo,
      clients,
      slots,
      setup = {},
      resultCodes,
      mapsByPlayer,
      preferredMaps,
      randomMaps,
      chosenMap,
    }) => {
      const playersJson = matchInfo.players.map(p => {
        const slot = slots.find(s => s.name === p.name)

        return {
          id: p.id,
          name: p.name,
          race: slot.race,
          rating: p.rating,
        }
      })

      // Using `map` with `Promise.all` here instead of `forEach`, so our general error handler
      // catches any of the errors inside.
      await Promise.all(
        clients.map(async client => {
          this._publishToActiveClient(client.name, {
            type: 'matchReady',
            setup,
            resultCode: resultCodes.get(client.name),
            slots,
            players: playersJson,
            mapsByPlayer,
            preferredMaps,
            randomMaps,
            chosenMap,
          })

          let mapSelectionTimerId
          let countdownTimerId
          try {
            const mapSelectionTimer = createDeferred()
            mapSelectionTimer.catch(swallowNonBuiltins)
            this.clientTimers = this.clientTimers.update(client.name, new Timers(), timers =>
              timers.merge({ mapSelectionTimer }),
            )
            mapSelectionTimerId = setTimeout(() => mapSelectionTimer.resolve(), 5000)
            await mapSelectionTimer
            this._publishToActiveClient(client.name, { type: 'startCountdown' })

            const countdownTimer = createDeferred()
            countdownTimer.catch(swallowNonBuiltins)
            this.clientTimers = this.clientTimers.update(client.name, new Timers(), timers =>
              timers.merge({ countdownTimer }),
            )
            countdownTimerId = setTimeout(() => countdownTimer.resolve(), 5000)
            await countdownTimer
            this._publishToActiveClient(client.name, { type: 'allowStart', gameId: setup.gameId })
          } finally {
            if (mapSelectionTimerId) {
              clearTimeout(mapSelectionTimerId)
              mapSelectionTimerId = null
            }
            if (countdownTimerId) {
              clearTimeout(countdownTimerId)
              countdownTimerId = null
            }
          }
        }),
      )
    },
    onRoutesSet: (clients, playerName, routes, gameId) => {
      this._publishToActiveClient(playerName, {
        type: 'setRoutes',
        routes,
        gameId,
      })
    },
    onGameLoaded: clients => {
      for (const client of clients) {
        this._publishToActiveClient(client.name, { type: 'gameStarted' })
        this._unregisterActivity(client)
      }
    },
  }

  _handleLeave = client => {
    // NOTE(2Pac): Client can leave, i.e. disconnect, during the queueing process, during the
    // loading process, or even during the game process.
    const entry = this.queueEntries.get(client.name)
    // Means the client disconnected during the queueing process
    if (entry) {
      this.queueEntries = this.queueEntries.delete(client.name)
      this.matchmakers.get(entry.type).removeFromQueue(entry.username)
      this.acceptor.registerDisconnect(client)
    }

    // Means the client disconnected during the loading process
    if (this.clientTimers.has(client.name)) {
      const { mapSelectionTimer, countdownTimer } = this.clientTimers.get(client.name)
      if (countdownTimer) {
        countdownTimer.reject(new Error('Countdown cancelled'))
      }
      if (mapSelectionTimer) {
        mapSelectionTimer.reject(new Error('Map selection cancelled'))
      }

      this.clientTimers = this.clientTimers.delete(client.name)
    }

    this._unregisterActivity(client)
  }

  _unregisterActivity(client) {
    activityRegistry.unregisterClientForUser(client.name)
    this._publishToUser(client.name, {
      type: 'status',
      matchmaking: null,
    })

    const user = this.userSockets.getByName(client.name)
    if (user) {
      user.unsubscribe(MatchmakingApi._getUserPath(client.name))
    }
    client.unsubscribe(MatchmakingApi._getClientPath(client))
  }

  @Api(
    '/find',
    validateBody({
      type: isValidMatchmakingType,
      race: validRace,
    }),
  )
  async find(data, next) {
    const { type, race, useAlternateRace, alternateRace, preferredMaps } = data.get('body')
    const user = this.getUser(data)
    const client = this.getClient(data)

    if (matchmakingStatusInstance && !matchmakingStatusInstance.isEnabled(type)) {
      throw new errors.Conflict('matchmaking is currently disabled')
    }

    if (!activityRegistry.registerActiveClient(user.name, client)) {
      throw new errors.Conflict('user is already active in a gameplay activity')
    }

    const queueEntry = new QueueEntry({ type, username: user.name })
    this.queueEntries = this.queueEntries.set(user.name, queueEntry)

    // TODO(2Pac): Get rating from the database and calculate the search interval for that player.
    // Until we implement the ranking system, make the search interval same for all players
    const rating = 1000
    const interval = new Interval({
      low: rating - 50,
      high: rating + 50,
    })
    const player = new Player({
      id: user.session.userId,
      name: user.name,
      rating,
      interval,
      race,
      useAlternateRace,
      alternateRace,
      preferredMaps: Set(preferredMaps),
    })
    this.matchmakers.get(type).addToQueue(player)

    user.subscribe(MatchmakingApi._getUserPath(user.name), () => {
      return {
        type: 'status',
        matchmaking: { type },
      }
    })
    client.subscribe(MatchmakingApi._getClientPath(client), undefined, this._handleLeave)
  }

  @Api('/cancel')
  async cancel(data, next) {
    const user = this.getUser(data)
    const client = activityRegistry.getClientForUser(user.name)
    if (!client || !this.queueEntries.has(user.name)) {
      throw new errors.Conflict('user does not have an active matchmaking queue')
    }

    this._handleLeave(client)
  }

  @Api('/accept')
  async accept(data, next) {
    const client = this.getClient(data)
    if (!this.acceptor.registerAccept(client)) {
      throw new errors.NotFound('no active match found')
    }
  }

  getUser(data) {
    const user = this.userSockets.getBySocket(data.get('client'))
    if (!user) throw new errors.Unauthorized('authorization required')
    return user
  }

  getClient(data) {
    const client = this.clientSockets.getCurrentClient(data.get('client'))
    if (!client) throw new errors.Unauthorized('authorization required')
    return client
  }

  _publishToUser(username, data) {
    this.nydus.publish(MatchmakingApi._getUserPath(username), data)
  }

  _publishToActiveClient(username, data) {
    const client = activityRegistry.getClientForUser(username)
    if (client) {
      this.nydus.publish(MatchmakingApi._getClientPath(client), data)
    }
  }

  static _getUserPath(username) {
    return `${MOUNT_BASE}/${encodeURIComponent(username)}`
  }

  static _getClientPath(client) {
    return `${MOUNT_BASE}/${client.userId}/${client.clientId}`
  }
}

export default function registerApi(nydus, userSockets, clientSockets) {
  if (!MATCHMAKING) return null
  const api = new MatchmakingApi(nydus, userSockets, clientSockets)
  registerApiRoutes(api, nydus)
  return api
}
