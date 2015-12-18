import { Map, OrderedMap, Record } from 'immutable'
import cuid from 'cuid'
import errors from 'http-errors'
import { Mount, Api, registerApiRoutes } from '../websockets/api-decorators'

function validateBody(bodyValidators) {
  return async function(data, next) {
    const body = data.get('body')
    if (!body) throw new errors.BadRequest('invalid body')
    for (const key of Object.keys(bodyValidators)) {
      if (!bodyValidators[key](body[key])) {
        throw new errors.BadRequest(`Invalid ${key}`)
      }
    }

    return await next(data)
  }
}

const nonEmptyString = str => typeof str === 'string' && str.length > 0

const Player = new Record({ name: null, id: null, race: 'r', isComputer: false, slot: -1 })

export const Players = {
  createHuman(name, race, slot) {
    return new Player({ name, race, id: cuid(), isComputer: false, slot })
  },

  createComputer(race, slot) {
    return new Player({ name: 'robit', race, id: cuid(), isComputer: true, slot })
  },
}

const Lobby = new Record({
  name: null,
  map: null,
  numSlots: 0,
  players: new OrderedMap(),
  hostId: null,
})


export const Lobbies = {
  // Creates a new lobby, and an initial host player in the first slot.
  create(name, map, numSlots, hostName, hostRace = 'r') {
    const host = Players.createHuman(hostName, hostRace, 0)
    return new Lobby({
      name,
      map,
      numSlots,
      players: new OrderedMap({ [host.id]: host }),
      hostId: host.id
    })
  },

  // Serializes a lobby to a summary-form in JSON, suitable for e.g. displaying a list of all the
  // open lobbies.
  toSummaryJson(lobby) {
    return JSON.stringify({
      name: lobby.name,
      map: lobby.map,
      numSlots: lobby.numSlots,
      host: { name: lobby.getIn(['players', lobby.hostId, 'name']), id: lobby.hostId },
      filledSlots: lobby.players.size,
    })
  },

  // Finds the next empty slot in the lobby. Returns -1 if there are no available slots.
  findEmptySlot(lobby) {
    if (lobby.numSlots <= lobby.players.size) {
      return -1
    }

    const slots = lobby.players.map(p => p.slot).toSet()
    for (let s = 0; s < lobby.numSlots; s++) {
      if (!slots.has(s)) {
        return s
      }
    }
  },

  // Adds a player to the lobby, returning the updated lobby. The player should already have the
  // proper slot set (see #findEmptySlot).
  addPlayer(lobby, player) {
    if (player.slot < 0 || player.slot >= lobby.numSlots) {
      throw new Error('slot out of bounds')
    } else if (lobby.players.some(p => p.slot === player.slot)) {
      throw new Error('slot conflict')
    }

    return lobby.setIn(['players', player.id], player)
  },

  // Removes the player with specified `id` from a lobby, returning the updated lobby. If the lobby
  // is closed (e.g. because it no longer has any human players), null will be returned. Note that
  // if the host is being removed, a new, suitable host will be chosen.
  removePlayerById(lobby, id) {
    const updated = lobby.deleteIn(['players', id])
    if (updated === lobby) {
      // nothing removed, e.g. player wasn't in the lobby
      return lobby
    }

    if (updated.players.isEmpty()) {
      return null
    }

    if (lobby.hostId === id) {
      // the player we removed was the host, find a new host
      const newHost = updated.players.skipWhile(p => p.isComputer).first()
      // if a new host was found, set their ID, else close the lobby (only computers left)
      return newHost ? updated.set('hostId', newHost.id) : null
    }

    return updated
  },

  // Removes the player with the specified `name` from a lobby, returning the updated lobby. This
  // method will only work for removing human players (computer players do not have unique names).
  // If the lobby is closed, null will be returned. Note that if the host is being removed, a new,
  // suitable host will be chosen.
  removePlayerByName(lobby, name) {
    const player = lobby.players.find(p => !p.isComputer && p.name === name)
    if (!player) {
      return lobby
    }

    return Lobbies.removePlayerById(lobby, player.id)
  },
}

const MOUNT_BASE = '/lobbies'

@Mount(MOUNT_BASE)
export class LobbyApi {
  constructor(nydus, userSockets) {
    this.nydus = nydus
    this.userSockets = userSockets
    this.lobbies = new Map()
    this.lobbyUsers = new Map()
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

    if (this.lobbies.has(name)) {
      throw new errors.Conflict('already another lobby with that name')
    }

    const lobby = Lobbies.create(name, map, numSlots, user.name)
    this.lobbies = this.lobbies.set(name, lobby)
    this.lobbyUsers = this.lobbyUsers.set(user, name)
    user.subscribe(LobbyApi._getPath(lobby), () => ({
      type: 'init',
      lobby: this.lobbies.get(name),
    }))
  }

  @Api('/join',
    validateBody({
      name: nonEmptyString,
    }),
    'getUser',
    'ensureNotInLobby')
  async join(data, next) {
    const { name } = data.get('body')
    const user = data.get('user')

    if (!this.lobbies.has(name)) {
      throw new errors.NotFound('no lobby found with that name')
    }

    let lobby = this.lobbies.get(name)
    const slot = Lobbies.findEmptySlot(lobby)
    if (slot < 0) {
      throw new errors.Conflict('lobby is full')
    }
    const player = Players.createHuman(user.name, 'r', slot)
    lobby = Lobbies.addPlayer(lobby, player)
    this.lobbies = this.lobbies.set(name, lobby)
    this.lobbyUsers = this.lobbyUsers.set(user, name)

    this.nydus.publishTo(lobby, {
      type: 'join',
      player,
    })
    user.subscribe(LobbyApi._getPath(lobby), () => ({
      type: 'init',
      lobby: this.lobbies.get(name),
    }))
  }

  @Api('/leave',
    'getUser',
    'getLobby')
  async leave(data, next) {
    const user = data.get('user')
    const lobby = data.get('lobby')
    const updatedLobby = Lobbies.removePlayerByName(lobby, user.name)

    if (!updatedLobby) {
      this.lobbies = this.lobbies.delete(lobby.name)
    } else {
      this.lobbies = this.lobbies.set(lobby.name, updatedLobby)
    }
    this.lobbyUsers = this.lobbyUsers.delete(user)

    this.nydus.publishTo(lobby, {
      type: 'leave',
      name: user.name,
    })
    user.unsubscribe(LobbyApi._getPath(lobby))

    if (updatedLobby && updatedLobby.hostId !== lobby.hostId) {
      this.nydus.publishTo(lobby, {
        type: 'hostChange',
        newId: updatedLobby.hostId,
      })
    }
  }

  async getUser(data, next) {
    const user = this.userSockets.get(data.client)
    if (!user) throw new errors.Unauthorized('authorization required')
    const newData = data.set('user', user)

    return await next(newData)
  }

  async ensureNotInLobby(data, next) {
    if (this.lobbyUsers.has(data.get('user'))) {
      throw new errors.Conflict('cannot enter multiple lobbies at once')
    }

    return await next(data)
  }

  async getLobby(data, next) {
    const user = data.get('user')
    if (!this.lobbyUsers.has(user)) {
      throw new errors.BadRequest('must be in a lobby')
    }
    const newData = data.set('lobby', this.lobbies.get(this.lobbyUsers.get(user)))

    return await next(newData)
  }

  _publishTo(lobby, data) {
    this.nydus.publish(LobbyApi._getPath(lobby), data)
  }

  static _getPath(lobby) {
    return `${MOUNT_BASE}/${encodeURIComponent(lobby.name)}`
  }
}

export default function registerApi(nydus, userSockets) {
  const api = new LobbyApi(nydus, userSockets)
  registerApiRoutes(api, nydus)
  return api
}
