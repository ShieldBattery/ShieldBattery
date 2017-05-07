import { List, Map, Record, Set } from 'immutable'
import errors from 'http-errors'
import { Mount, Api, registerApiRoutes } from '../websockets/api-decorators'
import validateBody from '../websockets/validate-body'
import pickServer from '../rally-point/pick-server'
import pingRegistry from '../rally-point/ping-registry'
import routeCreator from '../rally-point/route-creator'
import gameplayActivity from '../gameplay-activity/gameplay-activity'
import * as Lobbies from '../lobbies/lobby'
import * as Slots from '../lobbies/slot'
import { mapInfo } from '../maps/store'
import CancelToken from '../../../app/common/async/cancel-token'
import createDeferred from '../../../app/common/async/deferred'
import rejectOnTimeout from '../../../app/common/async/reject-on-timeout'
import { LOBBY_NAME_MAXLENGTH, validRace } from '../../../app/common/constants'
import {
  isUms,
  getLobbySlots,
  getLobbySlotsWithIndexes,
  getHumanSlots,
  findSlotByName,
  findSlotById,
  hasOpposingSides,
} from '../../../app/common/lobbies'

const LOBBY_START_TIMEOUT = 30 * 1000
const GAME_TYPES = new Set([
  'melee',
  'ffa',
  'topVBottom',
  'teamMelee',
  'teamFfa',
  'ums',
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
  constructor(nydus, userSockets, clientSockets) {
    this.nydus = nydus
    this.userSockets = userSockets
    this.clientSockets = clientSockets
    this.lobbies = new Map()
    this.lobbyClients = new Map()
    this.lobbyBannedUsers = new Map()
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
    const client = this.getClient(data)
    gameplayActivity.addClient(user.name, client)

    if (this.lobbies.has(name)) {
      throw new errors.Conflict('already another lobby with that name')
    }

    const mapData = (await mapInfo(map))[0]
    if (!mapData) {
      throw new errors.BadRequest('invalid map')
    }
    checkSubTypeValidity(gameType, gameSubType, mapData.slots)

    // Team Melee and FFA always provide 8 player slots, divided amongst the teams evenly
    const numSlots = gameType === 'teamMelee' || gameType === 'teamFfa' ? 8 : mapData.slots

    const lobby = Lobbies.create(name, mapData, gameType, gameSubType, numSlots, client.name)
    this.lobbies = this.lobbies.set(name, lobby)
    this.lobbyClients = this.lobbyClients.set(client, name)
    this._subscribeClientToLobby(lobby, user, client)

    this._publishListChange('add', Lobbies.toSummaryJson(lobby))
  }

  @Api('/join',
    validateBody({
      name: validLobbyName,
    }))
  async join(data, next) {
    const { name } = data.get('body')
    const user = this.getUser(data)
    const client = this.getClient(data)
    gameplayActivity.addClient(user.name, client)

    if (!this.lobbies.has(name)) {
      throw new errors.NotFound('no lobby found with that name')
    }
    const lobby = this.lobbies.get(name)
    this.ensureLobbyNotTransient(lobby)

    if (this.lobbyBannedUsers.has(lobby.name) &&
        this.lobbyBannedUsers.get(lobby.name).includes(client.name)) {
      throw new errors.Conflict('user has been banned from this lobby')
    }

    const [teamIndex, slotIndex, availableSlot] = Lobbies.findAvailableSlot(lobby)
    if (teamIndex < 0 || slotIndex < 0) {
      throw new errors.Conflict('lobby is full')
    }

    const player = isUms(lobby.gameType) ?
        Slots.createHuman(client.name, availableSlot.race, true, availableSlot.playerId) :
        Slots.createHuman(client.name)
    const updated = Lobbies.addPlayer(lobby, teamIndex, slotIndex, player)
    this.lobbies = this.lobbies.set(name, updated)
    this.lobbyClients = this.lobbyClients.set(client, name)

    this._publishLobbyDiff(lobby, updated)
    this._subscribeClientToLobby(lobby, user, client)
  }

  _subscribeClientToLobby(lobby, user, client) {
    const lobbyName = lobby.name
    client.subscribe(LobbyApi._getPath(lobby), () => {
      const lobby = this.lobbies.get(lobbyName)
      return {
        type: 'init',
        lobby,
      }
    }, client => this._removeClientFromLobby(this.lobbies.get(lobbyName), user, client))
    user.subscribe(LobbyApi._getUserPath(lobby, user.name), () => {
      return {
        type: 'status',
        lobby: Lobbies.toSummaryJson(lobby),
      }
    })
    client.subscribe(LobbyApi._getClientPath(lobby, client))
  }

  @Api('/sendChat',
    validateBody({
      text: nonEmptyString,
    }))
  async sendChat(data, next) {
    const client = this.getClient(data)
    const lobby = this.getLobbyForClient(client)
    const time = Date.now()
    let { text } = data.get('body')

    if (text.length > 500) {
      text = text.slice(0, 500)
    }

    this._publishTo(lobby, {
      type: 'chat',
      time,
      from: client.name,
      text,
    })
  }

  @Api('/addComputer',
    validateBody({
      slotId: nonEmptyString,
    }))
  async addComputer(data, next) {
    const client = this.getClient(data)
    const lobby = this.getLobbyForClient(client)
    const [, , player] = findSlotByName(lobby, client.name)
    this.ensureIsLobbyHost(lobby, player)
    this.ensureLobbyNotTransient(lobby)

    if (isUms(lobby.gameType)) {
      throw new errors.BadRequest('invalid game type: ' + lobby.gameType)
    }

    const { slotId } = data.get('body')
    const [teamIndex, slotIndex, slotToAddComputer] = findSlotById(lobby, slotId)
    if (!slotToAddComputer) {
      throw new errors.BadRequest('invalid id')
    }
    if (slotToAddComputer.type !== 'open' && slotToAddComputer.type !== 'closed') {
      throw new errors.BadRequest('invalid slot type')
    }

    const computer = Slots.createComputer()
    const updated = Lobbies.addPlayer(lobby, teamIndex, slotIndex, computer)
    this.lobbies = this.lobbies.set(lobby.name, updated)
    this._publishLobbyDiff(lobby, updated)
  }

  @Api('/changeSlot',
    validateBody({
      slotId: nonEmptyString,
    }))
  async changeSlot(data, next) {
    const client = this.getClient(data)
    const lobby = this.getLobbyForClient(client)
    this.ensureLobbyNotTransient(lobby)
    const [sourceTeamIndex, sourceSlotIndex, sourceSlot] = findSlotByName(lobby, client.name)

    const { slotId } = data.get('body')
    const [destTeamIndex, destSlotIndex, destSlot] = findSlotById(lobby, slotId)
    if (!destSlot) {
      throw new errors.BadRequest('invalid id')
    }
    if (destSlot.type !== 'open' && destSlot.type !== 'controlledOpen') {
      throw new errors.BadRequest('invalid destination slot type')
    }
    if (sourceSlot === destSlot) {
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
    const client = this.getClient(data)
    const lobby = this.getLobbyForClient(client)
    this.ensureLobbyNotLoading(lobby)
    const [, , player] = findSlotByName(lobby, client.name)

    const { id, race } = data.get('body')
    const [teamIndex, slotIndex, slotToSetRace] = findSlotById(lobby, id)
    if (!slotToSetRace) {
      throw new errors.BadRequest('invalid id')
    }
    if (slotToSetRace.type !== 'computer' && slotToSetRace.type !== 'human' &&
        slotToSetRace.type !== 'controlledOpen' && slotToSetRace.type !== 'controlledClosed') {
      throw new errors.BadRequest('invalid slot type')
    }

    if (slotToSetRace.type === 'computer') {
      this.ensureIsLobbyHost(lobby, player)
    } else if (slotToSetRace.controlledBy) {
      if (slotToSetRace.controlledBy !== player.id) {
        throw new errors.Forbidden('must control a slot to set its race')
      }
    } else if (slotToSetRace.id !== player.id) {
      throw new errors.Forbidden('cannot set other user\'s races')
    } else if (slotToSetRace.hasForcedRace) {
      throw new errors.Forbidden('this slot has a forced race and cannot be changed')
    }

    const updatedLobby = Lobbies.setRace(lobby, teamIndex, slotIndex, race)
    this.lobbies = this.lobbies.set(lobby.name, updatedLobby)
    this._publishLobbyDiff(lobby, updatedLobby)
  }

  @Api('/openSlot',
    validateBody({
      slotId: nonEmptyString,
    }))
  async openSlot(data, next) {
    const client = this.getClient(data)
    const lobby = this.getLobbyForClient(client)
    const [, , player] = findSlotByName(lobby, client.name)
    this.ensureIsLobbyHost(lobby, player)
    this.ensureLobbyNotTransient(lobby)

    const { slotId } = data.get('body')
    const [teamIndex, slotIndex, slotToOpen] = findSlotById(lobby, slotId)
    if (!slotToOpen) {
      throw new errors.BadRequest('invalid slot id')
    }
    if (slotToOpen.type === 'open' || slotToOpen.type === 'controlledOpen' ||
        slotToOpen.type === 'umsComputer') {
      throw new errors.BadRequest('invalid slot type')
    }

    let updated
    try {
      updated = Lobbies.openSlot(lobby, teamIndex, slotIndex)
    } catch (err) {
      throw new errors.BadRequest(err.message)
    }

    this.lobbies = this.lobbies.set(lobby.name, updated)
    this._publishLobbyDiff(lobby, updated)
  }

  @Api('/closeSlot',
    validateBody({
      slotId: nonEmptyString,
    }))
  async closeSlot(data, next) {
    const user = this.getUser(data)
    const client = this.getClient(data)
    const lobby = this.getLobbyForClient(client)
    const [, , player] = findSlotByName(lobby, client.name)
    this.ensureIsLobbyHost(lobby, player)
    this.ensureLobbyNotTransient(lobby)

    const { slotId } = data.get('body')
    const [teamIndex, slotIndex, slotToClose] = findSlotById(lobby, slotId)
    if (!slotToClose) {
      throw new errors.BadRequest('invalid slot id')
    }

    if (slotToClose.type === 'closed' || slotToClose.type === 'controlledClosed' ||
        slotToClose.type === 'umsComputer') {
      throw new errors.BadRequest('invalid slot type')
    }

    if (slotToClose.type === 'human' || slotToClose.type === 'computer') {
      this._kickPlayerFromLobby(lobby, user, teamIndex, slotIndex, slotToClose)
    }
    const afterKick = this.lobbies.get(lobby.name)

    let updated
    try {
      updated = Lobbies.closeSlot(afterKick, teamIndex, slotIndex)
    } catch (err) {
      throw new errors.BadRequest(err.message)
    }
    this.lobbies = this.lobbies.set(lobby.name, updated)
    this._publishLobbyDiff(afterKick, updated)
  }

  @Api('/kickPlayer')
  async kickPlayer(data, next) {
    const user = this.getUser(data)
    const client = this.getClient(data)
    const lobby = this.getLobbyForClient(client)
    const [, , player] = findSlotByName(lobby, client.name)
    this.ensureIsLobbyHost(lobby, player)
    this.ensureLobbyNotTransient(lobby)

    const { slotId } = data.get('body')
    const [teamIndex, slotIndex, playerToKick] = findSlotById(lobby, slotId)
    if (!playerToKick) {
      throw new errors.BadRequest('invalid slot id')
    }
    if (playerToKick.type !== 'human' && playerToKick.type !== 'computer') {
      throw new errors.BadRequest('invalid slot type')
    }

    this._kickPlayerFromLobby(lobby, user, teamIndex, slotIndex, playerToKick)
  }

  _kickPlayerFromLobby(lobby, user, teamIndex, slotIndex, playerToKick) {
    if (playerToKick.type === 'computer') {
      const updated = Lobbies.removePlayer(lobby, teamIndex, slotIndex, playerToKick)
      this.lobbies = this.lobbies.set(lobby.name, updated)
      this._publishLobbyDiff(lobby, updated)
    } else if (playerToKick.type === 'human') {
      const userToRemove = this.getUserByName(playerToKick.name)
      const clientToRemove = gameplayActivity.getClientByName(playerToKick.name)
      this._removeClientFromLobby(lobby, userToRemove, clientToRemove, playerToKick.name)
    }
  }

  @Api('/banPlayer')
  async banPlayer(data, next) {
    const client = this.getClient(data)
    const lobby = this.getLobbyForClient(client)
    const [, , player] = findSlotByName(lobby, client.name)
    this.ensureIsLobbyHost(lobby, player)
    this.ensureLobbyNotTransient(lobby)

    const { slotId } = data.get('body')
    const [, , playerToBan] = findSlotById(lobby, slotId)
    if (!playerToBan) {
      throw new errors.BadRequest('invalid slot id')
    }
    if (playerToBan.type !== 'human') {
      throw new errors.BadRequest('invalid slot type')
    }

    this.lobbyBannedUsers =
        this.lobbyBannedUsers.update(lobby.name, new List(), val => val.push(playerToBan.name))

    const userToRemove = this.getUserByName(playerToBan.name)
    const clientToRemove = gameplayActivity.getClientByName(playerToBan.name)
    this._removeClientFromLobby(lobby, userToRemove, clientToRemove, null, playerToBan.name)
  }

  @Api('/leave')
  async leave(data, next) {
    const user = this.getUser(data)
    const client = gameplayActivity.getClientByName(user.name)
    const lobby = this.getLobbyForClient(client)
    this._removeClientFromLobby(lobby, user, client)
  }

  _removeClientFromLobby(lobby, user, client, kickedUser, bannedUser) {
    const [teamIndex, slotIndex, player] = findSlotByName(lobby, client.name)
    const updatedLobby = Lobbies.removePlayer(lobby, teamIndex, slotIndex, player)

    if (!updatedLobby) {
      // Ensure the client's local state gets updated to confirm the leave
      this._publishTo(lobby, {
        type: 'leave',
        player,
      })
      this.lobbies = this.lobbies.delete(lobby.name)
      this.lobbyBannedUsers = this.lobbyBannedUsers.delete(lobby.name)
      this._publishListChange('delete', lobby.name)
    } else {
      this.lobbies = this.lobbies.set(lobby.name, updatedLobby)
      this._publishLobbyDiff(lobby, updatedLobby, kickedUser, bannedUser)
    }
    this.lobbyClients = this.lobbyClients.delete(client)
    gameplayActivity.deleteClient(user.name)

    this._publishToUser(lobby, user.name, {
      type: 'status',
      lobby: null,
    })

    user.unsubscribe(LobbyApi._getUserPath(lobby, user.name))
    client.unsubscribe(LobbyApi._getClientPath(lobby, client))
    client.unsubscribe(LobbyApi._getPath(lobby))
    this._maybeCancelCountdown(lobby)
    this._maybeCancelLoading(lobby)
  }

  @Api('/startCountdown')
  async startCountdown(data, next) {
    const client = this.getClient(data)
    const lobby = this.getLobbyForClient(client)
    if (!hasOpposingSides(lobby)) {
      throw new errors.BadRequest('must have at least 2 opposing sides')
    }

    const [, , player] = findSlotByName(lobby, client.name)
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
      this._publishToClient(lobby, player.name, {
        type: 'setRoutes',
        routes,
      })
    }
    if (!hasMultipleHumans) {
      this._publishToClient(lobby, humanPlayers.first().name, {
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
    const client = this.getClient(data)
    const lobby = this.getLobbyForClient(client)
    this.ensureLobbyLoading(lobby)
    const [, , player] = findSlotByName(lobby, client.name)

    let loadingData = this.loadingLobbies.get(lobby.name)
    loadingData = loadingData.set('finishedUsers', loadingData.finishedUsers.add(player.id))
    this.loadingLobbies = this.loadingLobbies.set(lobby.name, loadingData)

    const players = getHumanSlots(lobby)
    if (LoadingDatas.isAllFinished(loadingData, players)) {
      // TODO(tec27): register this game in the DB for accepting results in another service
      this._publishTo(lobby, { type: 'gameStarted' })

      players.map(p => gameplayActivity.getClientByName(p.name))
        .forEach(client => {
          const user = this.getUserByName(client.name)
          this._publishToUser(lobby, user.name, {
            type: 'status',
            lobby: null,
          })
          user.unsubscribe(LobbyApi._getUserPath(lobby, user.name))
          client.unsubscribe(LobbyApi._getPath(lobby))
          client.unsubscribe(LobbyApi._getClientPath(lobby, client))
          this.lobbyClients = this.lobbyClients.delete(client)
          gameplayActivity.deleteClient(user.name)
        })
      this.loadingLobbies = this.loadingLobbies.delete(lobby.name)
      this.lobbies = this.lobbies.delete(lobby.name)
      loadingData.deferred.resolve()
    }
  }

  @Api('/loadFailed')
  async loadFailed(data, next) {
    const client = this.getClient(data)
    const lobby = this.getLobbyForClient(client)
    this.ensureLobbyLoading(lobby)
    this._maybeCancelLoading(lobby)
  }

  @Api('/getLobbyState',
    validateBody({
      lobbyName: nonEmptyString,
    }))
  async getLobbyState(data, next) {
    this.getClient(data)
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

  getLobbyForClient(client) {
    if (!this.lobbyClients.has(client)) {
      throw new errors.BadRequest('must be in a lobby')
    }
    return this.lobbies.get(this.lobbyClients.get(client))
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

  _publishToUser(lobby, username, data) {
    this.nydus.publish(LobbyApi._getUserPath(lobby, username), data)
  }

  _publishToClient(lobby, playername, data) {
    const client = gameplayActivity.getClientByName(playername)
    this.nydus.publish(LobbyApi._getClientPath(lobby, client), data)
  }

  _publishLobbyDiff(oldLobby, newLobby, kickedUser = null, bannedUser = null) {
    if (oldLobby === newLobby) return

    const diffEvents = []
    if (newLobby.host.id !== oldLobby.host.id) {
      diffEvents.push({
        type: 'hostChange',
        host: newLobby.host,
      })
    }

    const oldSlots = new Set(getLobbySlots(oldLobby).map(oldSlot => oldSlot.id))
    const newSlots = new Set(getLobbySlots(newLobby).map(newSlot => newSlot.id))
    const oldHumans = new Set(getHumanSlots(oldLobby).map(oldHuman => oldHuman.id))
    const same = oldSlots.intersect(newSlots)
    const left = oldHumans.subtract(same)
    const created = newSlots.subtract(same)

    const oldIdSlots = new Map(getLobbySlotsWithIndexes(oldLobby)
        .map(([teamIndex, slotIndex, slot]) => [slot.id, [teamIndex, slotIndex, slot]]))
    const newIdSlots = new Map(getLobbySlotsWithIndexes(newLobby)
        .map(([teamIndex, slotIndex, slot]) => [slot.id, [teamIndex, slotIndex, slot]]))

    for (const id of left.values()) {
      // These are the human slots that have left the lobby or were removed. Note that every `leave`
      // operation also triggers a `slotCreate` operation, which means that we don't have to set
      // slots on the client-side in response to this operation (since they'll be overriden in the
      // `slotCreate` operation below anyways). This also means we only care about `human` slots
      // leaving just so we can display appropriate message in the lobby.
      const [, , player] = oldIdSlots.get(id)
      if (kickedUser === player.name) {
        diffEvents.push({
          type: 'kick',
          player,
        })
      } else if (bannedUser === player.name) {
        diffEvents.push({
          type: 'ban',
          player,
        })
      } else {
        diffEvents.push({
          type: 'leave',
          player,
        })
      }
    }
    for (const id of created.values()) {
      // These are all of the slots that were created in the new lobby compared to the old one. This
      // includes the slots that were created as a result of players leaving the lobby, moving to a
      // different slot, open/closing a slot, etc.
      const [teamIndex, slotIndex, slot] = newIdSlots.get(id)
      diffEvents.push({
        type: 'slotCreate',
        teamIndex,
        slotIndex,
        slot,
      })
    }

    for (const id of same.values()) {
      const [oldTeamIndex, oldSlotIndex, oldSlot] = oldIdSlots.get(id)
      const [newTeamIndex, newSlotIndex, newSlot] = newIdSlots.get(id)

      const samePlace = oldTeamIndex === newTeamIndex && oldSlotIndex === newSlotIndex
      if (samePlace && oldSlot === newSlot) continue

      if (!samePlace && oldSlot.id === newSlot.id) {
        diffEvents.push({
          type: 'slotChange',
          teamIndex: newTeamIndex,
          slotIndex: newSlotIndex,
          player: newSlot,
        })
      }
      if (samePlace && oldSlot.race !== newSlot.race) {
        diffEvents.push({
          type: 'raceChange',
          teamIndex: newTeamIndex,
          slotIndex: newSlotIndex,
          newRace: newSlot.race,
        })
      }
    }

    if (diffEvents.length) {
      this._publishTo(newLobby, {
        type: 'diff',
        diffEvents,
      })
    }

    this._publishListChange('update', Lobbies.toSummaryJson(newLobby))
  }

  static _getPath(lobby) {
    return `${MOUNT_BASE}/${encodeURIComponent(lobby.name)}`
  }

  static _getUserPath(lobby, username) {
    return `${MOUNT_BASE}/${encodeURIComponent(lobby.name)}/${encodeURIComponent(username)}`
  }

  static _getClientPath(lobby, client) {
    return `${MOUNT_BASE}/${encodeURIComponent(lobby.name)}/${client.userId}/${client.clientId}`
  }
}

export default function registerApi(nydus, userSockets, clientSockets) {
  const api = new LobbyApi(nydus, userSockets, clientSockets)
  registerApiRoutes(api, nydus)
  return api
}
