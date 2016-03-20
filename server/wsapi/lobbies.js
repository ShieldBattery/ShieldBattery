import { List, Map, OrderedMap, Record, Set } from 'immutable'
import cuid from 'cuid'
import errors from 'http-errors'
import { Mount, Api, registerApiRoutes } from '../websockets/api-decorators'

import MAPS from '../maps/maps.json'
const MAPS_BY_HASH = new Map(MAPS.map(m => [m.hash, m]))

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

  // Updates the race of a particular player, returning the updated lobby.
  setRace(lobby, id, newRace) {
    return lobby.setIn(['players', id, 'race'], newRace)
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

  // Finds the player with the specified name in the lobby. Only works for human players (computer
  // players do not have unique names). If no player is found, undefined will be returned.
  findPlayerByName(lobby, name) {
    return lobby.players.find(p => !p.isComputer && p.name === name)
  },

  // Finds the player with the specified slot number in the lobby. If no player is found, undefined
  // will be returned.
  findPlayerBySlot(lobby, slotNum) {
    return lobby.players.find(p => p.slot === slotNum)
  }
}

const Countdown = new Record({
  timer: null,
})

const NetworkInfo = new Record({
  addresses: new List(),
  port: -1
})
// Data collected in preparation for actually starting a game
const Prep = new Record({
  networkInfo: new Map(),
  seed: 0,
})

export const Preps = {
  isComplete(prep, lobby) {
    return lobby.players.every((p, id) => p.isComputer || prep.networkInfo.has(id))
  }
}

function generateSeed() {
  return (Math.random() * 0xFFFFFFFF) | 0
}

const LoadingData = new Record({
  finishedUsers: new Set(),
})

export const LoadingDatas = {
  isAllFinished(loadingData, lobby) {
    return lobby.players.every((p, id) => p.isComputer || loadingData.finishedUsers.has(id))
  }
}

const slotNum = s => s >= 0 && s <= 7
const validRace = r => r === 'r' || r === 't' || r === 'z' || r === 'p'
const validPortNumber = p => p > 0 && p <= 65535

const MOUNT_BASE = '/lobbies'

@Mount(MOUNT_BASE)
export class LobbyApi {
  constructor(nydus, userSockets) {
    this.nydus = nydus
    this.userSockets = userSockets
    this.lobbies = new Map()
    this.lobbyUsers = new Map()
    this.lobbyLocks = new Map()
    this.lobbyCountdowns = new Map()
    this.lobbyPreps = new Map()
    this.loadingLobbies = new Map()
  }

  @Api('/create',
      validateBody({
        name: nonEmptyString,
        map: nonEmptyString,
      }),
      'getUser',
      'ensureNotInLobby')
  async create(data, next) {
    const { name, map } = data.get('body')
    const user = data.get('user')

    if (this.lobbies.has(name)) {
      throw new errors.Conflict('already another lobby with that name')
    }

    if (!MAPS_BY_HASH.has(map)) {
      throw new errors.BadRequest('invalid map')
    }
    const mapData = MAPS_BY_HASH.get(map)

    const lobby = Lobbies.create(name, mapData, mapData.slots, user.name)
    this.lobbies = this.lobbies.set(name, lobby)
    this.lobbyUsers = this.lobbyUsers.set(user, name)
    this._subscribeUserToLobby(lobby, user)
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
    this._syncEnsureLobbyNotTransient(name)

    let lobby = this.lobbies.get(name)
    const slot = Lobbies.findEmptySlot(lobby)
    if (slot < 0) {
      throw new errors.Conflict('lobby is full')
    }
    const player = Players.createHuman(user.name, 'r', slot)
    lobby = Lobbies.addPlayer(lobby, player)
    this.lobbies = this.lobbies.set(name, lobby)
    this.lobbyUsers = this.lobbyUsers.set(user, name)

    this._publishTo(lobby, {
      type: 'join',
      player,
    })
    this._subscribeUserToLobby(lobby, user)
  }

  _subscribeUserToLobby(lobby, user) {
    const lobbyName = lobby.name
    user.subscribe(LobbyApi._getPath(lobby), () => {
      const lobby = this.lobbies.get(lobbyName)
      return {
        type: 'init',
        lobby,
      }
    }, user => this._removeUserFromLobby(this.lobbies.get(lobbyName), user))
  }

  @Api('/addComputer',
    validateBody({
      slotNum
    }),
    'getUser',
    'acquireLobby',
    'getPlayer',
    'ensureIsLobbyHost',
    'ensureLobbyNotTransient')
  async addComputer(data, next) {
    const { slotNum } = data.get('body')
    let lobby = data.get('lobby')

    if (slotNum >= lobby.numSlots) {
      throw new errors.BadRequest('invalid slot number')
    }
    if (Lobbies.findPlayerBySlot(lobby, slotNum)) {
      throw new errors.Conflict('slot already occupied')
    }

    const computer = Players.createComputer('r', slotNum)
    lobby = Lobbies.addPlayer(lobby, computer)
    this.lobbies = this.lobbies.set(lobby.name, lobby)

    this._publishTo(lobby, {
      type: 'join',
      player: computer,
    })
  }

  @Api('/setRace',
    validateBody({
      id: nonEmptyString,
      race: validRace,
    }),
    'getUser',
    'acquireLobby',
    'getPlayer',
    'ensureLobbyNotLoading')
  async setRace(data, next) {
    const { id, race } = data.get('body')
    const lobby = data.get('lobby')
    const player = data.get('player')

    if (!lobby.players.has(id)) {
      throw new errors.BadRequest('invalid id')
    }

    const playerToSetRace = lobby.players.get(id)
    if (!playerToSetRace.isComputer && player.id !== playerToSetRace.id) {
      throw new errors.Forbidden('cannot set other user\'s races')
    } else if (playerToSetRace.isComputer) {
      await this.ensureIsLobbyHost(data, () => Promise.resolve())
    }

    const updatedLobby = Lobbies.setRace(lobby, id, race)
    if (lobby === updatedLobby) {
      // same race as before
      return
    }
    this.lobbies = this.lobbies.set(lobby.name, updatedLobby)

    this._publishTo(lobby, {
      type: 'raceChange',
      id,
      newRace: race,
    })
  }

  @Api('/leave',
    'getUser',
    'acquireLobby')
  async leave(data, next) {
    const lobby = data.get('lobby')
    const user = data.get('user')
    this._removeUserFromLobby(lobby, user)
  }

  _removeUserFromLobby(lobby, user) {
    const id = Lobbies.findPlayerByName(lobby, user.name).id
    const updatedLobby = Lobbies.removePlayerById(lobby, id)

    if (!updatedLobby) {
      this.lobbies = this.lobbies.delete(lobby.name)
    } else {
      this.lobbies = this.lobbies.set(lobby.name, updatedLobby)
    }
    this.lobbyUsers = this.lobbyUsers.delete(user)

    if (updatedLobby && updatedLobby.hostId !== lobby.hostId) {
      this._publishTo(lobby, {
        type: 'hostChange',
        newId: updatedLobby.hostId,
      })
    }

    this._publishTo(lobby, {
      type: 'leave',
      id,
    })
    user.unsubscribe(LobbyApi._getPath(lobby))
    this._maybeCancelCountdown(lobby)
    this._maybeCancelLoading(lobby)
  }

  @Api('/startCountdown',
    'getUser',
    'acquireLobby',
    'getPlayer',
    'ensureIsLobbyHost',
    'ensureLobbyNotTransient')
  async startCountdown(data, next) {
    const lobby = data.get('lobby')
    const lobbyName = lobby.name
    if (lobby.players.size < 2) {
      throw new errors.BadRequest('must have at least 2 players')
    }

    const timer = setTimeout(() => this._completeCountdown(lobbyName), 5000)
    const countdown = new Countdown({ timer })
    this.lobbyCountdowns = this.lobbyCountdowns.set(lobbyName, countdown)
    this.lobbyPreps = this.lobbyPreps.set(lobbyName, new Prep({ seed: generateSeed() }))

    this._publishTo(lobby, {
      type: 'startCountdown',
    })
  }

  _completeCountdown(lobbyName) {
    this.lobbyCountdowns = this.lobbyCountdowns.delete(lobbyName)
    const lobby = this.lobbies.get(lobbyName)
    const preps = this.lobbyPreps.get(lobbyName)
    this.lobbyPreps = this.lobbyPreps.delete(lobbyName)

    // TODO(tec27): This basically gives everyone a 5 second time to submit network info, and if
    // they don't arrive in time, we cancel the thing. Is that enough time?
    if (!Preps.isComplete(preps, lobby)) {
      // TODO(tec27): Give a more specific reason? (e.g. players that weren't ready)
      this._publishTo(lobby, {
        type: 'cancelCountdown',
        reason: 'incomplete setup data',
      })
      return
    }

    this.loadingLobbies = this.loadingLobbies.set(lobbyName, new LoadingData())
    this._publishTo(lobby, {
      type: 'setupGame',
      setup: preps,
    })
  }

  // Cancels the countdown if one was occurring (no-op if it was not)
  _maybeCancelCountdown(lobby) {
    if (!this.lobbyCountdowns.has(lobby.name)) {
      return
    }

    const countdown = this.lobbyCountdowns.get(lobby.name)
    clearTimeout(countdown.timer)
    this.lobbyCountdowns = this.lobbyCountdowns.delete(lobby.name)
    this.lobbyPreps = this.lobbyPreps.delete(lobby.name)
    this._publishTo(lobby, {
      type: 'cancelCountdown',
    })
  }

  // Cancels the loading state if the lobby was in it (no-op if it was not)
  _maybeCancelLoading(lobby) {
    if (!this.loadingLobbies.has(lobby.name)) {
      return
    }

    this.loadingLobbies = this.loadingLobbies.delete(lobby.name)
    this._publishTo(lobby, {
      type: 'cancelLoading',
    })
  }

  @Api('/setNetworkInfo',
    validateBody({
      port: validPortNumber,
    }),
    'getUser',
    'acquireLobby',
    'getPlayer')
  async setNetworkInfo(data, next) {
    const lobby = data.get('lobby')
    const lobbyName = lobby.name
    if (!this.lobbyCountdowns.has(lobbyName)) {
      throw new errors.BadRequest('countdown must be started')
    }

    const { conn: { request: req } } = data.get('client')
    const { port } = data.get('body')
    const networkInfo = new NetworkInfo({
      // TODO(tec27): We'll definitely need more addresses than this
      addresses: new List([req.connection.remoteAddress]),
      port,
    })
    const { id } = data.get('player')
    this.lobbyPreps = this.lobbyPreps.setIn([lobbyName, 'networkInfo', id], networkInfo)
  }

  @Api('/gameLoaded',
    'getUser',
    'acquireLobby',
    'getPlayer',
    'ensureLobbyLoading')
  async gameLoaded(data, next) {
    const lobby = data.get('lobby')
    const { id } = data.get('player')
    let loadingData = this.loadingLobbies.get(lobby.name)
    loadingData = loadingData.set('finishedUsers', loadingData.finishedUsers.add(id))
    this.loadingLobbies.set(lobby.name, loadingData)

    if (LoadingDatas.isAllFinished(loadingData, lobby)) {
      // TODO(tec27): register this game in the DB for accepting results in another service
      this._publishTo(lobby, { type: 'gameStarted' })

      lobby.players.filter(p => !p.isComputer)
        .map(p => this.userSockets.getByName(p.name))
        .forEach(user => {
          user.unsubscribe(LobbyApi._getPath(lobby))
          this.lobbyUsers = this.lobbyUsers.delete(user)
        })
      this.loadingLobbies = this.loadingLobbies.delete(lobby.name)
      this.lobbies = this.lobbies.delete(lobby.name)
    }
  }

  @Api('/loadFailed',
    'getUser',
    'acquireLobby',
    'getPlayer',
    'ensureLobbyLoading')
  async loadFailed(data, next) {
    this._maybeCancelLoading()
  }

  async getUser(data, next) {
    const user = this.userSockets.getBySocket(data.get('client'))
    if (!user) throw new errors.Unauthorized('authorization required')
    const newData = data.set('user', user)

    return await next(newData)
  }

  // This method should be called whenever further methods may modify a Lobby. This essentially
  // creates a queue per lobby, and prevents multiple mutations on the same lobby from
  // interleaving and resulting in invalid state.
  async acquireLobby(data, next) {
    const user = data.get('user')
    if (!this.lobbyUsers.has(user)) {
      throw new errors.BadRequest('must be in a lobby')
    }

    const lobbyName = this.lobbyUsers.get(user)
    const lock = this.lobbyLocks.get(lobbyName) || Promise.resolve()

    const continuer = () => {
      // Double check that they're still in the lobby
      if (!this.lobbyUsers.has(user)) {
        throw new errors.BadRequest('must be in a lobby')
      }
      if (this.lobbyUsers.get(user) !== lobbyName) {
        // user has switched lobbies in the meantime, acquire that lobby instead
        return this.acquireLobby(data, next)
      }

      // At this point the lobby is acquired, do what we want with it
      const newData = data.set('lobby', this.lobbies.get(lobbyName))
      return next(newData)
    }

    const newLock = lock.then(continuer, continuer)
    this.lobbyLocks = this.lobbyLocks.set(lobbyName, newLock)

    return await newLock
  }

  async getPlayer(data, next) {
    const user = data.get('user')
    const lobby = data.get('lobby')

    const newData = data.set('player', Lobbies.findPlayerByName(lobby, user.name))

    return await next(newData)
  }

  async ensureNotInLobby(data, next) {
    if (this.lobbyUsers.has(data.get('user'))) {
      throw new errors.Conflict('cannot enter multiple lobbies at once')
    }

    return await next(data)
  }

  async ensureIsLobbyHost(data, next) {
    const lobby = data.get('lobby')
    const id = data.get('player').id

    if (id !== lobby.hostId) {
      throw new errors.Unauthorized('must be a lobby host')
    }

    return await next(data)
  }

  async ensureLobbyNotLoading(data, next) {
    const lobby = data.get('lobby')
    if (this.loadingLobbies.has(lobby.name)) {
      throw new errors.Conflict('lobby has already started')
    }

    return await next(data)
  }

  async ensureLobbyLoading(data, next) {
    const lobby = data.get('lobby')
    if (!this.loadingLobbies.has(lobby.name)) {
      throw new errors.Conflict('lobby must be loading')
    }

    return await next(data)
  }

  // Ensures that the lobby is not in a 'transient' state, that is, a state between being a lobby
  // and being an active game (counting down, loading, etc.). Transient states can be rolled back
  // (bringing the lobby back to a non-transient state)
  async ensureLobbyNotTransient(data, next) {
    const lobby = data.get('lobby')
    this._syncEnsureLobbyNotTransient(lobby.name)

    return await next(data)
  }

  _syncEnsureLobbyNotTransient(lobbyName) {
    if (this.lobbyCountdowns.has(lobbyName)) {
      throw new errors.Conflict('lobby is counting down')
    }
    if (this.loadingLobbies.has(lobbyName)) {
      throw new errors.Conflict('lobby has already started')
    }
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
