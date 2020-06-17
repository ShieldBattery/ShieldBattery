import { List, Map, Record } from 'immutable'
import errors from 'http-errors'
import { Mount, Api, registerApiRoutes } from '../websockets/api-decorators'
import validateBody from '../websockets/validate-body'
import activityRegistry from '../games/gameplay-activity-registry'
import gameLoader from '../games/game-loader'
import { createHuman } from '../lobbies/slot'
import { getMapInfo } from '../models/maps'
import { Interval, TimedMatchmaker } from '../matchmaking/matchmaker'
import MatchAcceptor from '../matchmaking/match-acceptor'
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
})

const Match = new Record({
  type: null,
  players: new List(),
})

const QueueEntry = new Record({
  username: null,
  type: null,
})

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
        new TimedMatchmaker(MATCHMAKING_INTERVAL, this._onMatchFound),
      ]),
    )
    this.acceptor = new MatchAcceptor(
      MATCHMAKING_ACCEPT_MATCH_TIME + ACCEPT_MATCH_LATENCY,
      this._onMatchAccepted,
      this._onMatchDeclined,
      this._onMatchAcceptProgress,
    )

    this.queueEntries = new Map()
  }

  _onMatchFound = (player, opponent) => {
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
  }

  _onMatchAcceptProgress = (matchInfo, total, accepted) => {
    for (const player of matchInfo.players) {
      this._publishToActiveClient(player.name, {
        type: 'playerAccepted',
        acceptedPlayers: accepted,
      })
    }
  }

  _onMatchAccepted = async (matchInfo, clients) => {
    try {
      const players = clients.map(c => createHuman(c.name))
      await gameLoader.loadGame(
        players,
        setup => this._onGameSetup(matchInfo, clients, players, setup),
        (playerName, routes, gameId) => this._onRoutesSet(clients, playerName, routes, gameId),
      )
      this._onGameLoaded(clients)
    } catch (err) {
      this._onLoadingCanceled(clients)
    }
  }

  async _onGameSetup(matchInfo, clients, players, setup = {}) {
    // TODO(2Pac): Select map intelligently based on user's preference
    const mapInfo = (await getMapInfo(['4cd22c4f-2924-42f3-91ae-0e85ddaace3d']))[0]

    if (!mapInfo) {
      throw new errors.BadRequest('invalid map')
    }

    this.queueEntries = this.queueEntries.withMutations(map => {
      for (const client of clients) {
        map.delete(client.name)
        this._publishToActiveClient(client.name, {
          type: 'matchReady',
          setup,
          players,
          matchInfo,
          mapInfo,
        })
      }
    })
  }

  _onRoutesSet(clients, playerName, routes, gameId) {
    this._publishToActiveClient(playerName, {
      type: 'setRoutes',
      routes,
      gameId,
    })
  }

  _onLoadingCanceled(clients) {
    for (const client of clients) {
      this._publishToActiveClient(client.name, {
        type: 'cancelLoading',
      })
      this._unregisterActivity(client)
    }
  }

  _onGameLoaded(clients) {
    for (const client of clients) {
      this._unregisterActivity(client)
    }
  }

  _onMatchDeclined = (matchInfo, requeueClients, kickClients) => {
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
  }

  _handleLeave = client => {
    const entry = this.queueEntries.get(client.name)
    this.queueEntries = this.queueEntries.delete(client.name)
    this.matchmakers.get(entry.type).removeFromQueue(entry.username)
    this.acceptor.registerDisconnect(client)
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
    const { type, race } = data.get('body')
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
