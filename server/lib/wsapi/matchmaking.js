import { Map, Record, Set } from 'immutable'
import errors from 'http-errors'
import cuid from 'cuid'
import { Mount, Api, registerApiRoutes } from '../websockets/api-decorators'
import validateBody from '../websockets/validate-body'
import activityRegistry from '../gameplay-activity/gameplay-activity-registry'
import Matchmaker from '../matchmaking/matchmaker'
import { Interval, Player, Match } from '../matchmaking/matchmaking-records'
import { MATCHMAKING_ACCEPT_MATCH_TIME, validRace } from '../../../app/common/constants'

const MatchmakerState = new Record({
  instance: null,
  tickTimer: null,
})

const QueueEntry = new Record({
  username: null,
  type: null,
})

const MATCHMAKING_TYPES = [
  '1v1'
]
const MATCHMAKING_INTERVAL = 10000
// Extra time that is added to the matchmaking accept time to account for latency in getting
// messages back and forth from clients
const ACCEPT_MATCH_LATENCY = 2000

const validType = type => MATCHMAKING_TYPES.includes(type)

const MOUNT_BASE = '/matchmaking'

@Mount(MOUNT_BASE)
export class MatchmakingApi {
  constructor(nydus, userSockets, clientSockets) {
    this.nydus = nydus
    this.userSockets = userSockets
    this.clientSockets = clientSockets
    this.matchmakers = new Map()
    this.clientQueueEntries = new Map()
    this.clientMatches = new Map()
    this.matchAcceptedPlayers = new Map()
    this.acceptMatchTimers = new Map()

    // Construct a new matchmaker for each matchmaking type we have
    for (const mmType of MATCHMAKING_TYPES) {
      const matchmaker = new Matchmaker(mmType,
          (player, opponent) => this._onMatchFound(player, opponent, mmType))
      this.matchmakers = this.matchmakers.set(mmType, new MatchmakerState({
        instance: matchmaker,
      }))
    }
  }

  _isEnabled(type) {
    // TODO(2Pac): Once the system for turning the matchmaking on/off dynamically is implemented,
    // add the logic here which determines if the matchmaker is currently enabled. For now it's
    // always on!
    return true
  }

  _isRunning(type) {
    return !!this.matchmakers.get(type).tickTimer
  }

  // Maybe starts the matchmaker service, if we have enough plyers to actually match, and runs the
  // `matchPlayers` function every `MATCHMAKING_INTERVAL`
  maybeStartMatchmaker(type) {
    if (!this._isEnabled(type) || this._isRunning(type)) {
      return
    }

    const { instance: matchmaker } = this.matchmakers.get(type)
    if (matchmaker.players.size >= 2) {
      const intervalId = setInterval(() => matchmaker.matchPlayers(), MATCHMAKING_INTERVAL)
      this.matchmakers.setIn([ type, 'tickTimer' ], intervalId)
    }
  }

  // Maybe stops the matchmaking service; depending on how many players there are left in the queue
  maybeStopMatchmaker(type) {
    if (!this._isRunning(type)) {
      return
    }

    const { instance: matchmaker, tickTimer } = this.matchmakers.get(type)
    if (matchmaker.players.size < 2) {
      clearInterval(tickTimer)
      this.matchmakers.setIn([ type, 'tickTimer' ], null)
    }
  }

  @Api('/find',
    validateBody({
      type: validType,
      race: validRace,
    }))
  async find(data, next) {
    const { type, race } = data.get('body')
    const user = this.getUser(data)
    const client = this.getClient(data)

    if (!activityRegistry.registerActiveClient(user.name, client)) {
      throw new errors.Conflict('user is already active in a gameplay activity')
    }

    this._placePlayerInQueue(type, client.name, race)
    this.clientQueueEntries = this.clientQueueEntries.set(client, new QueueEntry({
      username: client.name,
      type,
    }))

    user.subscribe(MatchmakingApi._getUserPath(user.name), () => {
      return {
        type: 'status',
        matchmaking: { type },
      }
    })
    client.subscribe(MatchmakingApi._getClientPath(client), undefined,
        client => this._removeClientFromQueue(client))
  }

  @Api('/cancel',
    validateBody({
      type: validType,
    }))
  async cancel(data, next) {
    const user = this.getUser(data)
    const client = activityRegistry.getClientForUser(user.name)
    if (!client) {
      throw new errors.Conflict('user does not have an active matchmaking queue')
    }

    this._removeClientFromQueue(client)
  }

  @Api('/accept')
  async accept(data, next) {
    const client = this.getClient(data)

    if (!this.clientMatches.has(client)) {
      throw new errors.Conflict('no active match for this client')
    }

    const match = this.clientMatches.get(client)
    if (this.matchAcceptedPlayers.has(match.id) &&
        this.matchAcceptedPlayers.get(match.id).has(client.name)) {
      // If someone happens to double click the accept button or something by accident, we just
      // return early (and make them see both requests as successful)
      return
    }
    this.matchAcceptedPlayers = this.matchAcceptedPlayers.update(match.id, new Set(),
        acceptedPlayers => acceptedPlayers.add(client.name))

    const acceptedPlayers = this.matchAcceptedPlayers.get(match.id)
    if (acceptedPlayers.size === match.players.size) {
      // All the players have accepted the match; notify them that they can start the match
      this.matchAcceptedPlayers = this.matchAcceptedPlayers.delete(match.id)
      this._cleanupAcceptMatchTimer(match.id)

      for (const player of match.players.values()) {
        // TODO(tec27): Write code to actually deal with game init, instead of doing this
        this._publishToClient(player.name, {
          type: 'ready',
          players: match.players,
        })
        this._removeClientFromQueue(activityRegistry.getClientForUser(player.name))
      }
    } else {
      // A player has accepted the match; notify all of the players
      for (const player of match.players.values()) {
        this._publishToClient(player.name, {
          type: 'accept',
          acceptedPlayers: acceptedPlayers.size,
        })
      }
    }
  }

  _removeClientFromQueue(client) {
    if (!this.clientQueueEntries.has(client)) {
      // Already removed (probably this is a re-entrant call due to onMatchNotAccepted)
      return
    }

    const { type } = this.clientQueueEntries.get(client)
    this.clientQueueEntries = this.clientQueueEntries.delete(client)

    // Check if the player is canceling while already having a match
    if (this.clientMatches.has(client)) {
      const match = this.clientMatches.get(client)
      // FIXME FIXME FIXME
      // Anyone who is *not* this player should be requeued, but right now they are removed
      this._onMatchNotAccepted(match)
    }

    this.matchmakers.get(type).instance.removeFromQueue(client.name)
    this.maybeStopMatchmaker(type)

    activityRegistry.unregisterClientForUser(client.name)
    this._publishToUser(client.name, {
      type: 'status',
      lobby: null,
    })
    this.getUserByName(client.name).unsubscribe(MatchmakingApi._getUserPath(client.name))
    client.unsubscribe(MatchmakingApi._getClientPath(client))
  }

  _onMatchFound(player, opponent, type) {
    const matchId = cuid()
    const match = new Match({
      id: matchId,
      type,
      players: new Map([
        [player.name, player],
        [opponent.name, opponent]
      ]),
    })
    const playerClient = activityRegistry.getClientForUser(player.name)
    const opponentClient = activityRegistry.getClientForUser(opponent.name)
    this.clientMatches = this.clientMatches.set(playerClient, match).set(opponentClient, match)
    this.matchAcceptedPlayers = this.matchAcceptedPlayers.set(match.id, new Set())

    // Notify both players that the match is found
    this._publishToClient(player.name, {
      type: 'matchFound',
      numPlayers: 2,
    })
    this._publishToClient(opponent.name, {
      type: 'matchFound',
      numPlayers: 2,
    })

    const acceptMatchTime = MATCHMAKING_ACCEPT_MATCH_TIME + ACCEPT_MATCH_LATENCY
    const timerId = setTimeout(() => this._onMatchNotAccepted(match), acceptMatchTime)
    this.acceptMatchTimers = this.acceptMatchTimers.set(matchId, timerId)
  }

  _onMatchNotAccepted(match) {
    // Remove the players who failed to accept the match from the matchmaking.
    // TODO(2Pac): Introduce some kind of a penalty?
    const players = new Set(match.players.keys())
    const acceptedPlayers = this.matchAcceptedPlayers.get(match.id)
    const notAcceptedPlayers = players.subtract(acceptedPlayers)

    this.matchAcceptedPlayers = this.matchAcceptedPlayers.delete(match.id)
    this._cleanupAcceptMatchTimer(match.id)

    for (const playerName of notAcceptedPlayers.values()) {
      this._publishToClient(playerName, {
        type: 'acceptTimeout',
      })
      const client = activityRegistry.getClientForUser(playerName)
      this.clientMatches = this.clientMatches.delete(client)
      this._removeClientFromQueue(client)
    }

    // Place players who accepted back into the queue; notify them that they're being requeued
    for (const playerName of acceptedPlayers.values()) {
      const client = activityRegistry.getClientForUser(playerName)
      this.clientMatches = this.clientMatches.delete(client)

      const race = match.players.get(playerName).race
      this._placePlayerInQueue(match.type, playerName, race)
      this._publishToClient(playerName, {
        type: 'requeue',
      })
    }

    this.maybeStopMatchmaker(match.type)
  }

  _placePlayerInQueue(type, username, race) {
    // TODO(2Pac): Get rating from the database and calculate the search interval for that player.
    // Until we implement the ranking system, make the search interval same for all players
    const rating = 1000
    const interval = new Interval({
      low: rating - 50,
      high: rating + 50
    })

    const player = new Player({
      name: username,
      rating,
      interval,
      race
    })

    this.matchmakers.get(type).instance.addToQueue(player)
    this.maybeStartMatchmaker(type)
  }

  _cleanupAcceptMatchTimer(matchId) {
    if (!this.acceptMatchTimers.has(matchId)) return

    const timer = this.acceptMatchTimers.get(matchId)
    clearTimeout(timer)
    this.acceptMatchTimers = this.acceptMatchTimers.delete(matchId)
  }

  getUser(data) {
    const user = this.userSockets.getBySocket(data.get('client'))
    if (!user) throw new errors.Unauthorized('authorization required')
    return user
  }

  getUserByName(name) {
    const user = this.userSockets.getByName(name)
    if (!user) throw new errors.BadRequest('user not online')
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

  _publishToClient(username, data) {
    const client = activityRegistry.getClientForUser(username)
    this.nydus.publish(MatchmakingApi._getClientPath(client), data)
  }

  static _getUserPath(username) {
    return `${MOUNT_BASE}/${encodeURIComponent(username)}`
  }

  static _getClientPath(client) {
    return `${MOUNT_BASE}/${client.userId}/${client.clientId}`
  }
}

export default function registerApi(nydus, userSockets, clientSockets) {
  const api = new MatchmakingApi(nydus, userSockets, clientSockets)
  registerApiRoutes(api, nydus)
  return api
}
