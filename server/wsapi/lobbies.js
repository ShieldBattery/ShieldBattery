import { EventEmitter } from 'events'
import { Map } from 'immutable'
import cuid from 'cuid'
import errors from '../http/errors'
import { Mount, Api, registerApiRoutes } from '../websockets/api-decorators'

function validateBody(bodyValidators) {
  return async function(data, next) {
    const body = data.get('body')
    if (!body) throw new errors.BadRequest('invalid body')
    for (const key of Object.keys(bodyValidators)) {
      if (!bodyValidators[key](body[key])) {
        throw new errors.BadRequestError(`Invalid ${key}`)
      }
    }

    return await next(data)
  }
}

const nonEmptyString = str => typeof str === 'string' && str.length > 0

class Player {
  constructor(name, race) {
    this.name = name
    this.id = cuid()
    this.race = race
  }
}

export class Lobby extends EventEmitter {
  constructor(name, map, numSlots, hostName, hostRace = 'r') {
    super()
    this.name = name
    this.map = map
    this.numSlots = numSlots
    this.players = new Map()
    this.slots = new Array(numSlots)
    this.hostName = hostName
    const { player: hostPlayer } = this.addPlayer(hostName, hostRace)
    this.hostId = hostPlayer.id

    const self = this
    this._serialized = {
      get name() { return self.name },
      get map() { return self.map },
      get numSlots() { return self.numSlots },
      get host() { return { name: self.hostName, id: self.hostId } },
      get filledSlots() { return self.players.size }
    }
  }

  toJSON() {
    return this._serialized
  }

  addPlayer(name, race = 'r') {
    if (this.players.size >= this.numSlots) throw new Error('no open slots')

    const player = new Player(name, race)
    this.players = this.players.set(player.id, player)
    let slot
    for (slot = 0; slot < this.slots.length; slot++) {
      if (!this.slots[slot]) {
        this.slots[slot] = player
        break
      }
    }
    if (slot === this.slots.length) throw new Error('no empty slot found')

    return { player, slot }
  }
}

@Mount('/lobbies')
export class LobbyApi {
  constructor(nydus, userSockets) {
    this.nydus = nydus
    this.userSockets = userSockets
    this.lobbyMap = new Map()
    this.userToLobby = new Map()
  }

  @Api('/create',
      validateBody({
        name: nonEmptyString,
        map: nonEmptyString,
        numSlots: s => s >= 2 && s <= 8,
      }),
      'getUser',
      'ensureNotInLobby')
  async create(data, next) {
    const { name, map, numSlots } = data.get('body')
    const user = data.get('user')

    if (this.lobbyMap.has('name')) {
      throw new errors.ConflictError('already another lobby with that name')
    }

    const lobby = new Lobby(name, map, numSlots, user.name)
    this.lobbyMap = this.lobbyMap.set(name, lobby)
    this.userToLobby = this.userToLobby.set(user, lobby)

    // TODO(travisc): in theory these should be unnecessary (we just need to monitor user
    // disconnects out here, and let Lobby tell us when it can be closed on parts (map disconnects
    // through same part code). Then Lobby could have less complexity (no need for EE).
    lobby.on('close', () => this.lobbyMap = this.lobbyMap.delete(name))
      .on('userLeft', user => this.userToLobby = this.userToLobby.delete(user))

    // TODO(tec27): subscribe user, deal with new sockets for that user
  }

  async getUser(data, next) {
    const user = this.userSockets.get(data.client)
    if (!user) throw new errors.UnauthorizedError('authorization required')
    const newData = data.set('user', user)

    return await next(newData)
  }

  async ensureNotInLobby(data, next) {
    if (this.userToLobby.has(data.get('user'))) {
      throw new errors.ConflictError('cannot enter multiple lobbies at once')
    }

    return await next(data)
  }
}

export default function registerApi(nydus, userSockets) {
  const api = new LobbyApi(nydus, userSockets)
  registerApiRoutes(api, nydus)
  return api
}
