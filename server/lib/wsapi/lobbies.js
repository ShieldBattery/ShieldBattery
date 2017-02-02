import { List, Map, Record, Set } from 'immutable'
import errors from 'http-errors'
import { Mount, Api, registerApiRoutes } from '../websockets/api-decorators'
import validateBody from '../websockets/validate-body'
import pickServer from '../rally-point/pick-server'
import pingRegistry from '../rally-point/ping-registry'
import routeCreator from '../rally-point/route-creator'
import * as Lobbies from '../lobbies/lobby'
import * as Slots from '../lobbies/slot'
import CancelToken from '../../../common/async/cancel-token'
import createDeferred from '../../../common/async/deferred'
import rejectOnTimeout from '../../../common/async/reject-on-timeout'
import { LOBBY_NAME_MAXLENGTH } from '../../../common/constants'
import {
  getLobbySlots,
  getHumanSlots,
  findSlotByName,
  findSlotById,
  hasOpposingSides,
} from '../../../common/lobbies/lobby-slots'

import MAPS from '../maps/maps.json'
const MAPS_BY_HASH = new Map(MAPS.map(m => [m.hash, m]))

const LOBBY_START_TIMEOUT = 30 * 1000
const GAME_TYPES = new Set([
  'melee',
  'ffa',
  'topVBottom',
  'teamMelee',
  'teamFfa',
])

const nonEmptyString = str => typeof str === 'string' && str.length > 0
const validLobbyName = str => nonEmptyString(str) && str.length <= LOBBY_NAME_MAXLENGTH
const validGameType = str => nonEmptyString(str) && GAME_TYPES.has(str)
const validGameSubType = type => !type || type >= 1 && type <= 7

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
  isAllFinished(loadingData, players) {
    return players.every(p => loadingData.finishedUsers.has(p.id))
  }
}

const ListSubscription = new Record({
  onUnsubscribe: null,
  count: 0,
})

const validRace = r => r === 'r' || r === 't' || r === 'z' || r === 'p'

function checkSubTypeValidity(gameType, gameSubType = 0, numSlots) {
  if (gameType === 'topVBottom') {
    if (gameSubType < 1 || gameSubType > (numSlots - 1)) {
      throw new errors.BadRequest('Invalid game sub-type')
    }
  } else if (gameType === 'teamMelee' || gameType === 'teamFfa') {
    if (gameSubType < 2 || gameSubType > Math.min(4, numSlots)) {
      throw new errors.BadRequest('Invalid game sub-type')
    }
  }
}

const MOUNT_BASE = '/lobbies'

@Mount(MOUNT_BASE)
export class LobbyApi {
  constructor(nydus, userSockets) {
    this.nydus = nydus
    this.userSockets = userSockets
    this.lobbies = new Map()
    this.lobbyUsers = new Map()
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
    socket.once('close', onClose)
    const subscription = new ListSubscription({
      onUnsubscribe: () => socket.removeListener('close', onClose),
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
        gameSubType: validGameSubType,
      }))
  async create(data, next) {
    const { name, map, gameType, gameSubType } = data.get('body')
    const user = this.getUser(data)
    this.ensureNotInLobby(user)

    if (this.lobbies.has(name)) {
      throw new errors.Conflict('already another lobby with that name')
    }

    if (!MAPS_BY_HASH.has(map)) {
      throw new errors.BadRequest('invalid map')
    }
    const mapData = MAPS_BY_HASH.get(map)
    checkSubTypeValidity(gameType, gameSubType, mapData.slots)

    // Team Melee and FFA always provide 8 player slots, divided amongst the teams evenly
    const numSlots = gameType === 'teamMelee' || gameType === 'teamFfa' ? 8 : mapData.slots

    const lobby = Lobbies.create(name, mapData, gameType, gameSubType, numSlots, user.name)
    this.lobbies = this.lobbies.set(name, lobby)
    this.lobbyUsers = this.lobbyUsers.set(user, name)
    this._subscribeUserToLobby(lobby, user)

    this._publishListChange('add', Lobbies.toSummaryJson(lobby))
  }

  @Api('/join',
    validateBody({
      name: validLobbyName,
    }))
  async join(data, next) {
    const { name } = data.get('body')
    const user = this.getUser(data)
    this.ensureNotInLobby(user)

    if (!this.lobbies.has(name)) {
      throw new errors.NotFound('no lobby found with that name')
    }
    const lobby = this.lobbies.get(name)
    this.ensureLobbyNotTransient(lobby)

    const [teamIndex, slotIndex] = Lobbies.findAvailableSlot(lobby)
    if (teamIndex < 0 || slotIndex < 0) {
      throw new errors.Conflict('lobby is full')
    }

    const player = Slots.createHuman(user.name)
    let updated
    try {
      updated = Lobbies.addPlayer(lobby, teamIndex, slotIndex, player)
    } catch (err) {
      throw new errors.BadRequest(err.message)
    }
    this.lobbies = this.lobbies.set(name, updated)
    this.lobbyUsers = this.lobbyUsers.set(user, name)

    this._publishLobbyDiff(lobby, updated)
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
    user.subscribe(LobbyApi._getPlayerPath(lobby, user.name))
  }

  @Api('/sendChat',
    validateBody({
      text: nonEmptyString,
    }))
  async sendChat(data, next) {
    const user = this.getUser(data)
    const lobby = this.getLobbyForUser(user)
    const time = Date.now()
    let { text } = data.get('body')

    if (text.length > 500) {
      text = text.slice(0, 500)
    }

    this._publishTo(lobby, {
      type: 'chat',
      time,
      from: user.name,
      text,
    })
  }

  @Api('/addComputer',
    validateBody({
      slotId: nonEmptyString,
    }))
  async addComputer(data, next) {
    const user = this.getUser(data)
    const lobby = this.getLobbyForUser(user)
    const [, , player] = findSlotByName(lobby, user.name)
    this.ensureIsLobbyHost(lobby, player)
    this.ensureLobbyNotTransient(lobby)

    const { slotId } = data.get('body')
    const [teamIndex, slotIndex, slotToAddComputer] = findSlotById(lobby, slotId)
    if (!slotToAddComputer) {
      throw new errors.BadRequest('invalid id')
    }

    if (teamIndex >= lobby.teams.size) {
      throw new errors.BadRequest('invalid team index')
    }
    if (slotIndex >= lobby.teams.get(teamIndex).slots.size) {
      throw new errors.BadRequest('invalid slot index')
    }
    if (slotToAddComputer.type !== 'open') {
      throw new errors.BadRequest('invalid slot type')
    }

    const computer = Slots.createComputer()
    let updated
    try {
      updated = Lobbies.addPlayer(lobby, teamIndex, slotIndex, computer)
    } catch (err) {
      throw new errors.BadRequest(err.message)
    }
    this.lobbies = this.lobbies.set(lobby.name, updated)
    this._publishLobbyDiff(lobby, updated)
  }

  @Api('/changeSlot',
    validateBody({
      slotId: nonEmptyString,
    }))
  async changeSlot(data, next) {
    const user = this.getUser(data)
    const lobby = this.getLobbyForUser(user)
    this.ensureLobbyNotTransient(lobby)
    const [sourceTeamIndex, sourceSlotIndex, sourceSlot] = findSlotByName(lobby, user.name)

    const { slotId } = data.get('body')
    const [destTeamIndex, destSlotIndex, destSlot] = findSlotById(lobby, slotId)
    if (!destSlot) {
      throw new errors.BadRequest('invalid id')
    }
    if (destTeamIndex >= lobby.teams.size) {
      throw new errors.BadRequest('invalid team index')
    }
    if (destSlotIndex >= lobby.teams.get(destTeamIndex).slots.size) {
      throw new errors.BadRequest('invalid slot index')
    }
    if (destSlot.type !== 'open' && destSlot.type !== 'controlledOpen') {
      throw new errors.BadRequest('invalid destination slot type')
    }
    if (sourceSlot.type !== 'human') {
      throw new errors.BadRequest('invalid source slot type')
    }
    if (sourceTeamIndex === destTeamIndex && sourceSlotIndex === destSlotIndex) {
      throw new errors.Conflict('already in that slot')
    }

    let updated
    try {
      updated = Lobbies.movePlayerToSlot(lobby, sourceTeamIndex, sourceSlotIndex, destTeamIndex,
          destSlotIndex)
    } catch (err) {
      throw new errors.BadRequest(err.message)
    }
    this.lobbies = this.lobbies.set(lobby.name, updated)
    this._publishLobbyDiff(lobby, updated)
  }

  @Api('/setRace',
    validateBody({
      id: nonEmptyString,
      race: validRace,
    }))
  async setRace(data, next) {
    const user = this.getUser(data)
    const lobby = this.getLobbyForUser(user)
    this.ensureLobbyNotLoading(lobby)
    const [, , player] = findSlotByName(lobby, user.name)

    const { id, race } = data.get('body')
    const [teamIndex, slotIndex, playerToSetRace] = findSlotById(lobby, id)
    if (!playerToSetRace) {
      throw new errors.BadRequest('invalid id')
    }

    if (playerToSetRace.type === 'computer') {
      this.ensureIsLobbyHost(lobby, player)
    } else if (playerToSetRace.controlledBy) {
      if (playerToSetRace.controlledBy !== player.id) {
        throw new errors.Forbidden('must control a slot to set its race')
      }
    } else if (playerToSetRace.id !== player.id) {
      throw new errors.Forbidden('cannot set other user\'s races')
    }

    const updatedLobby = Lobbies.setRace(lobby, teamIndex, slotIndex, race)
    this.lobbies = this.lobbies.set(lobby.name, updatedLobby)
    this._publishLobbyDiff(lobby, updatedLobby)
  }

  @Api('/leave')
  async leave(data, next) {
    const user = this.getUser(data)
    const lobby = this.getLobbyForUser(user)
    this._removeUserFromLobby(lobby, user)
  }

  _removeUserFromLobby(lobby, user) {
    const [teamIndex, slotIndex, player] = findSlotByName(lobby, user.name)
    const updatedLobby = Lobbies.removePlayer(lobby, teamIndex, slotIndex, player)

    if (!updatedLobby) {
      // Ensure the user's local state gets updated to confirm the leave
      this._publishTo(lobby, {
        type: 'leave',
        id: player.id,
      })
      this.lobbies = this.lobbies.delete(lobby.name)
      this._publishListChange('delete', lobby.name)
    } else {
      this.lobbies = this.lobbies.set(lobby.name, updatedLobby)
      this._publishLobbyDiff(lobby, updatedLobby)
    }
    this.lobbyUsers = this.lobbyUsers.delete(user)

    user.unsubscribe(LobbyApi._getPlayerPath(lobby, user.name))
    user.unsubscribe(LobbyApi._getPath(lobby))
    this._maybeCancelCountdown(lobby)
    this._maybeCancelLoading(lobby)
  }

  @Api('/startCountdown')
  async startCountdown(data, next) {
    const user = this.getUser(data)
    const lobby = this.getLobbyForUser(user)
    if (!hasOpposingSides(lobby)) {
      throw new errors.BadRequest('must have at least 2 opposing sides')
    }

    const [, , player] = findSlotByName(lobby, user.name)
    this.ensureIsLobbyHost(lobby, player)
    this.ensureLobbyNotTransient(lobby)

    const lobbyName = lobby.name
    const cancelToken = new CancelToken()
    const gameStart = this._doGameStart(lobbyName, cancelToken)
    // Swallow any errors from gameStart, they're all things we know about (and are handled by the
    // combined catch below properly, so no point in getting unhandled rejection logs from them)
    gameStart.catch(() => {})
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

    const humanPlayers = getHumanSlots(lobby)
    const hasMultipleHumans = humanPlayers.size > 1
    const pingPromise = !hasMultipleHumans ?
        Promise.resolve() :
        Promise.all(humanPlayers.map(p => pingRegistry.waitForPingResult(p.name)))

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

  @Api('/gameLoaded')
  async gameLoaded(data, next) {
    const user = this.getUser(data)
    const lobby = this.getLobbyForUser(user)
    this.ensureLobbyLoading(lobby)
    const [, , player] = findSlotByName(lobby, user.name)

    let loadingData = this.loadingLobbies.get(lobby.name)
    loadingData = loadingData.set('finishedUsers', loadingData.finishedUsers.add(player.id))
    this.loadingLobbies = this.loadingLobbies.set(lobby.name, loadingData)

    const players = getHumanSlots(lobby)
    if (LoadingDatas.isAllFinished(loadingData, players)) {
      // TODO(tec27): register this game in the DB for accepting results in another service
      this._publishTo(lobby, { type: 'gameStarted' })

      players.map(p => this.userSockets.getByName(p.name))
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

  @Api('/loadFailed')
  async loadFailed(data, next) {
    const user = this.getUser(data)
    const lobby = this.getLobbyForUser(user)
    this.ensureLobbyLoading(lobby)
    this._maybeCancelLoading(lobby)
  }

  @Api('/getLobbyState',
    validateBody({
      lobbyName: nonEmptyString,
    }))
  async getLobbyState(data, next) {
    this.getUser(data)
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

  getUser(data) {
    const user = this.userSockets.getBySocket(data.get('client'))
    if (!user) throw new errors.Unauthorized('authorization required')
    return user
  }

  getLobbyForUser(user) {
    if (!this.lobbyUsers.has(user)) {
      throw new errors.BadRequest('must be in a lobby')
    }
    return this.lobbies.get(this.lobbyUsers.get(user))
  }

  ensureNotInLobby(user) {
    if (this.lobbyUsers.has(user)) {
      throw new errors.Conflict('cannot enter multiple lobbies at once')
    }
  }

  ensureIsLobbyHost(lobby, player) {
    if (player.id !== lobby.host.id) {
      throw new errors.Unauthorized('must be a lobby host')
    }
  }

  ensureLobbyNotLoading(lobby) {
    if (this.loadingLobbies.has(lobby.name)) {
      throw new errors.Conflict('lobby has already started')
    }
  }

  ensureLobbyLoading(lobby) {
    if (!this.loadingLobbies.has(lobby.name)) {
      throw new errors.Conflict('lobby must be loading')
    }
  }

  // Ensures that the lobby is not in a 'transient' state, that is, a state between being a lobby
  // and being an active game (counting down, loading, etc.). Transient states can be rolled back
  // (bringing the lobby back to a non-transient state)
  ensureLobbyNotTransient(lobby) {
    if (this.lobbyCountdowns.has(lobby.name)) {
      throw new errors.Conflict('lobby is counting down')
    }
    if (this.loadingLobbies.has(lobby.name)) {
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

  _publishLobbyDiff(oldLobby, newLobby) {
    if (oldLobby === newLobby) return

    if (newLobby.host.id !== oldLobby.host.id) {
      this._publishTo(newLobby, {
        type: 'hostChange',
        host: newLobby.host,
      })
    }

    const oldSlots = Set(getLobbySlots(oldLobby).map(oldSlot => oldSlot.id))
    const newSlots = Set(getLobbySlots(newLobby).map(newSlot => newSlot.id))
    const oldHumans = Set(getHumanSlots(oldLobby).map(oldHuman => oldHuman.id))
    const same = oldSlots.intersect(newSlots)
    const left = oldHumans.subtract(same)
    const created = newSlots.subtract(same)

    for (const id of left.values()) {
      // These are the `human` slots that have left the lobby or were removed. Note that every
      // `leave` operation also triggers a `slotCreate` operation, which means that we don't have to
      // set slots on the client-side in response to this operation (since they'll be overriden in
      // the `slotCreate` operation below anyways). This also means we only care about `human` slots
      // leaving just so we can display 'player has left' message in the lobby.
      this._publishTo(newLobby, {
        type: 'leave',
        id,
      })
    }
    for (const id of created.values()) {
      // These are all of the slots that were created in the new lobby compared to the old one. This
      // includes the slots that were created as a result of players leaving the lobby, moving to an
      // other slot, etc.
      const [teamIndex, slotIndex, slot] = findSlotById(newLobby, id)
      this._publishTo(newLobby, {
        type: 'slotCreate',
        teamIndex,
        slotIndex,
        slot,
      })
    }

    for (const id of same.values()) {
      const [oldTeamIndex, oldSlotIndex, oldSlot] = findSlotById(oldLobby, id)
      const [newTeamIndex, newSlotIndex, newSlot] = findSlotById(newLobby, id)

      const samePlace = oldTeamIndex === newTeamIndex && oldSlotIndex === newSlotIndex
      if (samePlace && oldSlot === newSlot) continue

      if (!samePlace && oldSlot === newSlot) {
        this._publishTo(newLobby, {
          type: 'slotChange',
          teamIndex: newTeamIndex,
          slotIndex: newSlotIndex,
          player: newSlot,
        })
      }
      if (samePlace && oldSlot.race !== newSlot.race) {
        this._publishTo(newLobby, {
          type: 'raceChange',
          teamIndex: newTeamIndex,
          slotIndex: newSlotIndex,
          newRace: newSlot.race,
        })
      }
    }

    this._publishListChange('update', Lobbies.toSummaryJson(newLobby))
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
