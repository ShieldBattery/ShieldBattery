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
import createDeferred from '../../../common/async/deferred'
import {
  MATCHMAKING_ACCEPT_MATCH_TIME,
  MATCHMAKING_TYPES,
  isValidMatchmakingType,
  validRace,
} from '../../../common/constants'
import { MATCHMAKING } from '../../../common/flags'

const Player = new Record({
  name: null,
  rating: 0,
  interval: null,
  race: 'r',
  alternateRace: 'p',
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

@Mount(MOUNT_BASE)
export class MatchmakingApi {
  constructor(nydus, userSockets, clientSockets) {
    this.nydus = nydus
    this.userSockets = userSockets
    this.clientSockets = clientSockets

    this.matchmakers = new Map(
      MATCHMAKING_TYPES.map(type => [
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
        numPlayers: 2,
      })
      this._publishToActiveClient(opponent.name, {
        type: 'matchFound',
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

      const players = clients.map(c => createHuman(c.name))
      const { gameLoad } = gameLoader.loadGame(
        players,
        setup => this.gameLoaderDelegate.onGameSetup(matchInfo, clients, players, setup),
        (playerName, routes, gameId) =>
          this.gameLoaderDelegate.onRoutesSet(clients, playerName, routes, gameId),
      )

      await gameLoad
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
          reason: err && err.message,
        })
        this._unregisterActivity(client)
      }
    },
  }

  gameLoaderDelegate = {
    onGameSetup: async (matchInfo, clients, players, setup = {}) => {
      const currentMapPool = await getCurrentMapPool(matchInfo.type)
      if (!currentMapPool) {
        throw new Error('invalid map pool')
      }

      const mapPool = new Set(currentMapPool.maps)
      const preferredMapsHashes = matchInfo.players
        .reduce((acc, p) => acc.concat(p.preferredMaps), new Set())
        .filter(m => mapPool.includes(m))

      const randomMapsHashes = []
      Range(preferredMapsHashes.size, 4).forEach(() => {
        const availableMaps = mapPool.subtract(preferredMapsHashes.concat(randomMapsHashes))
        const randomMap = availableMaps.toList().get(getRandomInt(availableMaps.size))
        randomMapsHashes.push(randomMap)
      })

      const [preferredMaps, randomMaps] = await Promise.all([
        await getMapInfo(preferredMapsHashes.toJS()),
        await getMapInfo(randomMapsHashes),
      ])
      if (!preferredMaps.length && !randomMaps.length) {
        throw new Error('no maps found')
      }

      const chosenMap = [...preferredMaps, ...randomMaps][
        getRandomInt(preferredMaps.length + randomMaps.length)
      ]

      // Using `map` with `Promise.all` here instead of `forEach`, so our general error handler
      // catches any of the errors inside.
      await Promise.all(
        clients.map(async client => {
          this._publishToActiveClient(client.name, {
            type: 'matchReady',
            setup,
            players,
            matchInfo,
            preferredMaps,
            randomMaps,
            chosenMap,
          })

          let mapSelectionTimerId
          let countdownTimerId
          try {
            const mapSelectionTimer = createDeferred()
            this.clientTimers = this.clientTimers.update(client.name, new Timers(), timers =>
              timers.merge({ mapSelectionTimer }),
            )
            mapSelectionTimerId = setTimeout(() => mapSelectionTimer.resolve(), 5000)
            await mapSelectionTimer
            this._publishToActiveClient(client.name, { type: 'startCountdown' })

            const countdownTimer = createDeferred()
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
    const { type, race, alternateRace, preferredMaps } = data.get('body')
    const user = this.getUser(data)
    const client = this.getClient(data)

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
      name: user.name,
      rating,
      interval,
      race,
      alternateRace,
      preferredMaps,
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
