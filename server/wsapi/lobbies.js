import { EventEmitter } from 'events'
import { Map } from 'immutable'
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

class Lobby extends EventEmitter {
  constructor(name, map, numSlots, host) {
    super()
    this.name = name
    this.map = map
    this.numSlots = numSlots
    this.players = new Map()
    this.slots = new Array(numSlots)

    const self = this
    this._serialized = {
      get name() { return self.name },
      get map() { return self.map },
      get numSlots() { return self.numSlots },
      get host() { return { name: self.host.name, id: self.hostId } },
      get filledSlots() { return self.players.size }
    }
  }

  toJSON() {
    return this._serialized
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
        size: s => s >= 2 && s <= 8,
      }),
      'getUser',
      'ensureNotInLobby')
  async create(data, next) {
    const { name, map, size } = data.get('body')
    const user = data.get('user')

    if (this.lobbyMap.has('name')) {
      throw new errors.ConflictError('already another lobby with that name')
    }

    const lobby = new Lobby(name, map, size, user)
    this.lobbyMap = this.lobbyMap.set(name, lobby)
    this.userToLobby = this.userToLobby.set(user, lobby)

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
