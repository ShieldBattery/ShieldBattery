import { List, Map, OrderedMap, Record, Set } from 'immutable'
import cuid from 'cuid'
import errors from 'http-errors'
import { Mount, Api, registerApiRoutes } from '../websockets/api-decorators'
import validateBody from '../websockets/validate-body'
import pickServer from '../rally-point/pick-server'
import pingRegistry from '../rally-point/ping-registry'
import routeCreator from '../rally-point/route-creator'
import CancelToken from '../../shared/async/cancel-token'
import createDeferred from '../../shared/async/deferred'
import rejectOnTimeout from '../../shared/async/reject-on-timeout'
import { LOBBY_NAME_MAXLENGTH } from '../../shared/constants'

import MAPS from '../maps/maps.json'
const MAPS_BY_HASH = new Map(MAPS.map(m => [m.hash, m]))

const LOBBY_START_TIMEOUT = 30 * 1000
const GAME_TYPES = new Set([
  'melee',
  'ffa',
])

const nonEmptyString = str => typeof str === 'string' && str.length > 0
const validLobbyName = str => nonEmptyString(str) && str.length <= LOBBY_NAME_MAXLENGTH
const validGameType = str => nonEmptyString(str) && GAME_TYPES.has(str)

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
  gameType: 'melee',
})

export const Lobbies = {
  // Creates a new lobby, and an initial host player in the first slot.
  create(name, map, gameType, numSlots, hostName, hostRace = 'r') {
    const host = Players.createHuman(hostName, hostRace, 0)
    return new Lobby({
      name,
      map,
      gameType,
      numSlots,
      players: new OrderedMap({ [host.id]: host }),
      hostId: host.id
    })
  },

  // Serializes a lobby to a summary-form in JSON, suitable for e.g. displaying a list of all the
  // open lobbies.
  toSummaryJson(lobby) {
    return {
      name: lobby.name,
      map: lobby.map,
      gameType: lobby.gameType,
      numSlots: lobby.numSlots,
      host: { name: lobby.getIn(['players', lobby.hostId, 'name']), id: lobby.hostId },
      filledSlots: lobby.players.size,
    }
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

    throw new Error('Invalid state: not at max players but failed to find empty slot')
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

function generateSeed() {
  // BWChart and some other replay sites/libraries utilize the random seed as the date the game was
  // played, so we match BW's random seed method (time()) here
  return (Date.now() / 1000) | 0
}

const LoadingData = new Record({
  finishedUsers: new Set(),
  cancelToken: null,
  deferred: null,
})

export const LoadingDatas = {
  isAllFinished(loadingData, lobby) {
    return lobby.players.every((p, id) => p.isComputer || loadingData.finishedUsers.has(id))
  }
}

const ListSubscription = new Record({
  onUnsubscribe: null,
  count: 0,
})

const slotNum = s => s >= 0 && s <= 7
const validRace = r => r === 'r' || r === 't' || r === 'z' || r === 'p'

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
    this.pingPromises = new Map()
    this.loadingLobbies = new Map()
    this.subscribedSockets = new Map()
  }

  @Api('/subscribe')
  async subscribe(data, next) {
    const socket = data.get('client')
    if (this.subscribedSockets.has(socket.id)) {
      this.subscribedSockets = this.subscribedSockets.updateIn([socket.id, 'count'], c => c + 1)
      return
    }

    const summary = this.lobbies.valueSeq().map(l => Lobbies.toSummaryJson(l))
    this.nydus.subscribeClient(socket, MOUNT_BASE, { action: 'full', payload: summary })

    const onClose = () => {
      this.nydus.unsubscribeClient(socket, MOUNT_BASE)
      this.subscribedSockets = this.subscribedSockets.delete(socket.id)
    }
    const subscription = new ListSubscription({
      // TODO(tec27): this is a likely bug, removeEventListener isn't a thing on here, and we never
      // utilize onClose?
      onUnsubscribe: () => socket.removeEventListener(onClose),
      count: 1,
    })
    this.subscribedSockets = this.subscribedSockets.set(socket.id, subscription)
  }

  @Api('/unsubscribe')
  async unsubscribe(data, next) {
    const socket = data.get('client')
    if (!this.subscribedSockets.has(socket.id)) {
      throw new errors.Conflict('not subscribed')
    }

    const subscription = this.subscribedSockets.get(socket.id)
    if (subscription.count === 1) {
      this.nydus.unsubscribeClient(socket, MOUNT_BASE)
      this.subscribedSockets = this.subscribedSockets.delete(socket.id)
      subscription.onUnsubscribe()
    } else {
      this.subscribedSockets = this.subscribedSockets.updateIn([socket.id, 'count'], c => c - 1)
    }
  }

  @Api('/create',
      validateBody({
        name: validLobbyName,
        map: nonEmptyString,
        gameType: validGameType,
      }),
      'getUser',
      'ensureNotInLobby')
  async create(data, next) {
    const { name, map, gameType } = data.get('body')
    const user = data.get('user')

    if (this.lobbies.has(name)) {
      throw new errors.Conflict('already another lobby with that name')
    }

    if (!MAPS_BY_HASH.has(map)) {
      throw new errors.BadRequest('invalid map')
    }
    const mapData = MAPS_BY_HASH.get(map)

    const lobby = Lobbies.create(name, mapData, gameType, mapData.slots, user.name)
    this.lobbies = this.lobbies.set(name, lobby)
    this.lobbyUsers = this.lobbyUsers.set(user, name)
    this._subscribeUserToLobby(lobby, user)

    this._publishListChange('add', Lobbies.toSummaryJson(lobby))
  }

  @Api('/join',
    validateBody({
      name: validLobbyName,
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
    this._publishListChange('update', Lobbies.toSummaryJson(lobby))
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
    user.subscribe(LobbyApi._getPlayerPath(lobby, user.name))
  }

  @Api('/sendChat',
    validateBody({
      text: nonEmptyString,
    }),
    'getUser',
    'acquireLobby',
  )
  async sendChat(data, next) {
    const time = Date.now()
    const name = data.get('user').name
    let { text } = data.get('body')

    if (text.length > 500) {
      text = text.slice(0, 500)
    }

    this._publishTo(data.get('lobby'), {
      type: 'chat',
      time,
      from: name,
      text,
    })
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
    this._publishListChange('update', Lobbies.toSummaryJson(lobby))
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
      this._publishListChange('delete', lobby.name)
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
    user.unsubscribe(LobbyApi._getPlayerPath(lobby, user.name))
    user.unsubscribe(LobbyApi._getPath(lobby))
    this._maybeCancelCountdown(lobby)
    this._maybeCancelLoading(lobby)
    if (updatedLobby) {
      this._publishListChange('update', Lobbies.toSummaryJson(updatedLobby))
    }
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

    const cancelToken = new CancelToken()
    const gameStart = this._doGameStart(lobbyName, cancelToken)
    rejectOnTimeout(gameStart, LOBBY_START_TIMEOUT + 5000).catch(() => {
      cancelToken.cancel()
      if (!this.lobbies.has(lobbyName)) {
        return
      }

      const lobby = this.lobbies.get(lobbyName)
      this._maybeCancelCountdown(lobby)
      this._maybeCancelLoading(lobby)
    })
  }

  async _doGameStart(lobbyName, cancelToken) {
    const timer = createDeferred()
    let timerId = setTimeout(() => timer.resolve(), 5000)
    const countdown = new Countdown({ timer })
    this.lobbyCountdowns = this.lobbyCountdowns.set(lobbyName, countdown)

    let lobby = this.lobbies.get(lobbyName)
    this._publishTo(lobby, {
      type: 'startCountdown',
    })
    this._publishListChange('delete', lobby.name)
    lobby = null

    try {
      await timer
      timerId = null
      cancelToken.throwIfCancelling()
    } finally {
      if (timerId) {
        clearTimeout(timerId)
      }
    }

    this.lobbyCountdowns = this.lobbyCountdowns.delete(lobbyName)
    lobby = this.lobbies.get(lobbyName)
    const gameLoaded = createDeferred()
    this.loadingLobbies = this.loadingLobbies.set(lobbyName, new LoadingData({
      cancelToken,
      deferred: gameLoaded,
    }))
    this._publishTo(lobby, {
      type: 'setupGame',
      setup: {
        seed: generateSeed()
      },
    })

    const humanPlayers = lobby.players.filter(p => !p.isComputer).valueSeq().toList()
    const hasMultipleHumans = humanPlayers.size > 1
    const pingPromise = !hasMultipleHumans ?
        Promise.resolve() :
        Promise.all(lobby.players.filter(p => !p.isComputer)
            .map(p => pingRegistry.waitForPingResult(p.name)))

    await pingPromise
    cancelToken.throwIfCancelling()

    let routeCreations
    // TODO(tec27): pull this code out somewhere that its easily testable
    if (hasMultipleHumans) {
      // Generate all the pairings of human players to figure out the routes we need
      const matchGen = []
      let rest = humanPlayers
      while (!rest.isEmpty()) {
        const first = rest.first()
        rest = rest.rest()
        if (!rest.isEmpty()) {
          matchGen.push([first, rest])
        }
      }
      const needRoutes = matchGen.reduce((result, [ p1, players ]) => {
        players.forEach(p2 => result.push([p1, p2]))
        return result
      }, [])
      const pingsByPlayer = new Map(
        humanPlayers.map(player => [ player, pingRegistry.getPings(player.name)]))

      const routesToCreate = needRoutes.map(([p1, p2]) => ({
        p1,
        p2,
        server: pickServer(pingsByPlayer.get(p1), pingsByPlayer.get(p2))
      }))

      routeCreations = routesToCreate.map(({ p1, p2, server }) => server === -1 ?
          Promise.reject(new Error('No server match found')) :
          routeCreator.createRoute(pingRegistry.servers[server]).then(result => ({
            p1,
            p2,
            server: pingRegistry.servers[server],
            result,
          })))
    } else {
      routeCreations = []
    }

    const routes = await Promise.all(routeCreations)
    cancelToken.throwIfCancelling()

    // get a list of routes + player IDs per player, broadcast that to each player
    const routesByPlayer = routes.reduce((result, route) => {
      const { p1, p2, server, result: { routeId, p1Id, p2Id } } = route
      return (
        result
          .update(p1, new List(), val => val.push({ for: p2.id, server, routeId, playerId: p1Id }))
          .update(p2, new List(), val => val.push({ for: p1.id, server, routeId, playerId: p2Id }))
      )
    }, new Map())


    for (const [ player, routes ] of routesByPlayer.entries()) {
      this._publishToPlayer(lobby, player.name, {
        type: 'setRoutes',
        routes,
      })
    }
    if (!hasMultipleHumans) {
      this._publishToPlayer(lobby, humanPlayers.first().name, {
        type: 'setRoutes',
        routes: []
      })
    }
    lobby = null

    cancelToken.throwIfCancelling()
    await gameLoaded
  }

  // Cancels the countdown if one was occurring (no-op if it was not)
  _maybeCancelCountdown(lobby) {
    if (!this.lobbyCountdowns.has(lobby.name)) {
      return
    }

    const countdown = this.lobbyCountdowns.get(lobby.name)
    countdown.timer.reject(new Error('Countdown cancelled'))
    this.lobbyCountdowns = this.lobbyCountdowns.delete(lobby.name)
    this._publishTo(lobby, {
      type: 'cancelCountdown',
    })
    this._publishListChange('add', Lobbies.toSummaryJson(lobby))
  }

  // Cancels the loading state if the lobby was in it (no-op if it was not)
  _maybeCancelLoading(lobby) {
    if (!this.loadingLobbies.has(lobby.name)) {
      return
    }

    const loadingData = this.loadingLobbies.get(lobby.name)
    this.loadingLobbies = this.loadingLobbies.delete(lobby.name)
    loadingData.cancelToken.cancel()
    loadingData.deferred.reject(new Error('Game loading cancelled'))
    this._publishTo(lobby, {
      type: 'cancelLoading',
    })
    this._publishListChange('add', Lobbies.toSummaryJson(lobby))
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
    this.loadingLobbies = this.loadingLobbies.set(lobby.name, loadingData)

    if (LoadingDatas.isAllFinished(loadingData, lobby)) {
      // TODO(tec27): register this game in the DB for accepting results in another service
      this._publishTo(lobby, { type: 'gameStarted' })

      lobby.players.filter(p => !p.isComputer)
        .map(p => this.userSockets.getByName(p.name))
        .forEach(user => {
          user.unsubscribe(LobbyApi._getPath(lobby))
          user.unsubscribe(LobbyApi._getPlayerPath(lobby, user.name))
          this.lobbyUsers = this.lobbyUsers.delete(user)
        })
      this.loadingLobbies = this.loadingLobbies.delete(lobby.name)
      this.lobbies = this.lobbies.delete(lobby.name)
      loadingData.deferred.resolve()
    }
  }

  @Api('/loadFailed',
    'getUser',
    'acquireLobby',
    'getPlayer',
    'ensureLobbyLoading')
  async loadFailed(data, next) {
    this._maybeCancelLoading(data.get('lobby'))
  }

  @Api('/getLobbyState',
    validateBody({
      lobbyName: nonEmptyString,
    }),
    'getUser')
  async getLobbyState(data, next) {
    const { lobbyName } = data.get('body')

    let lobbyState
    if (!this.lobbies.has(lobbyName)) {
      lobbyState = 'nonexistent'
    } else {
      lobbyState = 'exists'
      if (this.lobbyCountdowns.has(lobbyName)) {
        lobbyState = 'countingDown'
      } else if (this.loadingLobbies.has(lobbyName)) {
        lobbyState = 'hasStarted'
      }
    }

    return { lobbyName, lobbyState }
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

  _publishListChange(action, summary) {
    this.nydus.publish(MOUNT_BASE, { action, payload: summary })
  }

  _publishTo(lobby, data) {
    this.nydus.publish(LobbyApi._getPath(lobby), data)
  }

  _publishToPlayer(lobby, playerName, data) {
    this.nydus.publish(LobbyApi._getPlayerPath(lobby, playerName), data)
  }

  static _getPath(lobby) {
    return `${MOUNT_BASE}/${encodeURIComponent(lobby.name)}`
  }

  static _getPlayerPath(lobby, playerName) {
    return `${MOUNT_BASE}/${encodeURIComponent(lobby.name)}/${encodeURIComponent(playerName)}`
  }
}

export default function registerApi(nydus, userSockets) {
  const api = new LobbyApi(nydus, userSockets)
  registerApiRoutes(api, nydus)
  return api
}
