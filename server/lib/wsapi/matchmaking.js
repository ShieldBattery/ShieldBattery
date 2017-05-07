import { Map, Set } from 'immutable'
import errors from 'http-errors'
import cuid from 'cuid'
import { Mount, Api, registerApiRoutes } from '../websockets/api-decorators'
import validateBody from '../websockets/validate-body'
import gameplayActivity from '../gameplay-activity/gameplay-activity'
import Matchmaker from '../matchmaking/matchmaker'
import { Interval, Player, Match } from '../matchmaking/matchmaking-records'
import { MATCHMAKING_ACCEPT_MATCH_TIME, validRace } from '../../../app/common/constants'

const MATCHMAKING_TYPES = [
  '1v1ladder'
]
const MATCHMAKING_INTERVAL = 10000
const ACCEPT_MATCH_LATENCY = 2000

const validateType = type => MATCHMAKING_TYPES.includes(type)

const MOUNT_BASE = '/matchmaking'

@Mount(MOUNT_BASE)
export class MatchmakingApi {
  constructor(nydus, userSockets, clientSockets) {
    this.nydus = nydus
    this.userSockets = userSockets
    this.clientSockets = clientSockets
    this.matchmakers = new Map()
    this.matchmakerTimers = new Map()
    this.clientMatches = new Map()
    this.matchAcceptedPlayers = new Map()
    this.acceptMatchTimers = new Map()

    // Construct a new matchmaker for each matchmaking type we have
    for (const mmType of MATCHMAKING_TYPES) {
      const matchmaker = new Matchmaker(mmType,
          (player, opponent) => this._onMatchFound(player, opponent, mmType))
      this.matchmakers = this.matchmakers.set(mmType, matchmaker)
    }
  }

  _isEnabled(type) {
    // TODO(2Pac): Once the system for turning the matchmaking on/off dynamically is implemented,
    // add the logic here which determines if the matchmaker is currently enabled. For now it's
    // always on!
    return true
  }

  _isRunning(type) {
    const mmTimer = this.matchmakerTimers.get(type)
    return !!mmTimer
  }

  // Maybe starts the matchmaker service, if we have enough plyers to actually match, and runs the
  // `matchPlayers` function every `MATCHMAKING_INTERVAL`
  maybeStartMatchmaker(type) {
    if (!this._isEnabled(type) || this._isRunning(type)) return

    const matchmaker = this.matchmakers.get(type)
    if (matchmaker.players.size > 1) {
      const mm = this.matchmakers.get(type)
      const intervalId = setInterval(() => mm.matchPlayers(), MATCHMAKING_INTERVAL)
      this.matchmakerTimers = this.matchmakerTimers.set(type, intervalId)
    }
  }

  // Maybe stops the matchmaking service; depending on how many players there are left in the queue
  maybeStopMatchmaker(type) {
    const matchmaker = this.matchmakers.get(type)
    if (matchmaker.players.size < 2) {
      const mmTimer = this.matchmakerTimers.get(type)
      if (mmTimer) {
        clearInterval(mmTimer)
        this.matchmakerTimers = this.matchmakerTimers.set(type, null)
      }
    }
  }

  @Api('/find',
    validateBody({
      type: validateType,
      race: validRace,
    }))
  async find(data, next) {
    const { type, race } = data.get('body')
    const user = this.getUser(data)
    const client = this.getClient(data)

    const matchmaker = this.matchmakers.get(type)
    if (matchmaker.players.has(user.name)) {
      throw new errors.Conflict('already searching for match')
    }
    if (this.clientMatches.has(client)) {
      throw new errors.Conflict('already have a match')
    }

    this._placePlayerInQueue(type, client.name, race)

    gameplayActivity.addClient(user.name, client)
    user.subscribe(MatchmakingApi._getUserPath(user.name), () => {
      return {
        type: 'status',
        matchmaking: { type },
      }
    })
    client.subscribe(MatchmakingApi._getClientPath(client), undefined, client =>
        client.unsubscribe(MatchmakingApi._getClientPath(client)))
  }

  @Api('/cancel',
    validateBody({
      type: validateType,
    }))
  async cancel(data, next) {
    const { type } = data.get('body')
    const user = this.getUser(data)
    const client = this.getClient(data)

    // Check if the player is canceling while already having a match
    if (this.clientMatches.has(user)) {
      const match = this.clientMatches.get(user)
      this.matchAcceptedPlayers = this.matchAcceptedPlayers.delete(match.id)
      this._cleanupAcceptMatchTimer(match.id)
      this.clientMatches = this.clientMatches.delete(user)
    }

    this.matchmakers.get(type).removeFromQueue(user.name)
    this.maybeStopMatchmaker(type)

    gameplayActivity.deleteClient(user.name)
    this._publishToUser(user.name, {
      type: 'status',
      lobby: null,
    })
    user.unsubscribe(MatchmakingApi._getUserPath(user.name))
    client.unsubscribe(MatchmakingApi._getClientPath(client))
  }

  @Api('/accept')
  async accept(data, next) {
    const client = this.getClient(data)

    if (!this.clientMatches.has(client)) {
      throw new errors.Conflict('no match for this client')
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
      for (const player of match.players.values()) {
        this._publishToClient(player.name, {
          type: 'ready',
          players: match.players,
        })

        // TODO: This should be done once the game is actually loaded, but need to do it somewhere
        // for now to clean up
        this._removePlayerFromMatchmaking(player.name, match.type)
      }

      this.matchAcceptedPlayers = this.matchAcceptedPlayers.delete(match.id)
      this._cleanupAcceptMatchTimer(match.id)
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
    const playerClient = gameplayActivity.getClientByName(player.name)
    const opponentClient = gameplayActivity.getClientByName(opponent.name)
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

    // Make the server's timer slightly longer to account for the back and forth latency from the
    // clients
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
    for (const playerName of notAcceptedPlayers.values()) {
      this._removePlayerFromMatchmaking(playerName, match.type)
    }

    this.matchAcceptedPlayers = this.matchAcceptedPlayers.delete(match.id)
    this._cleanupAcceptMatchTimer(match.id)

    // Place players who accepted back into the queue; notify them that they're being requeued
    for (const playerName of acceptedPlayers.values()) {
      const race = match.players.get(playerName).race
      this._placePlayerInQueue(match.type, playerName, race)
      this._publishToClient(playerName, {
        type: 'requeue',
      })

      const client = gameplayActivity.getClientByName(playerName)
      this.clientMatches = this.clientMatches.delete(client)
    }
  }

  _removePlayerFromMatchmaking(playerName, type) {
    const client = gameplayActivity.getClientByName(playerName)
    client.unsubscribe(MatchmakingApi._getClientPath(client))
    this.clientMatches = this.clientMatches.delete(client)

    const user = this.getUserByName(playerName)
    this._publishToUser(user.name, {
      type: 'status',
      lobby: null,
    })
    user.unsubscribe(MatchmakingApi._getUserPath(user.name))
    gameplayActivity.deleteClient(user.name)
    this.maybeStopMatchmaker(type)
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

    this.matchmakers.get(type).addToQueue(player)
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

  _publishToClient(playername, data) {
    const client = gameplayActivity.getClientByName(playername)
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
