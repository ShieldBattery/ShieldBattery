import errors from 'http-errors'
import { Map, Record, Set } from 'immutable'
import { NextFunc, NydusClient, NydusServer } from 'nydus'
import { container } from 'tsyringe'
import createDeferred, { Deferred } from '../../../common/async/deferred'
import swallowNonBuiltins from '../../../common/async/swallow-non-builtins'
import { isValidLobbyName, LOBBY_NAME_PATTERN, validRace } from '../../../common/constants'
import { GameConfig, GameSource } from '../../../common/games/configuration'
import { GameType, isValidGameSubType, isValidGameType } from '../../../common/games/game-type'
import {
  findSlotById,
  findSlotByUserId,
  getHumanSlots,
  getLobbySlots,
  getLobbySlotsWithIndexes,
  getObserverTeam,
  getPlayerInfos,
  hasOpposingSides,
  isUms,
  Lobby,
} from '../../../common/lobbies'
import { LobbySlotCreateEvent, LobbySummaryJson } from '../../../common/lobbies/lobby-network'
import * as Slots from '../../../common/lobbies/slot'
import { Slot } from '../../../common/lobbies/slot'
import { SbMapId } from '../../../common/maps'
import { ALL_TURN_RATES, BwTurnRate, TURN_RATE_DYNAMIC } from '../../../common/network'
import { urlPath } from '../../../common/urls'
import { RestrictionKind } from '../../../common/users/restrictions'
import { makeSbUserId, SbUserId } from '../../../common/users/sb-user-id'
import { toBasicChannelInfo } from '../chat/chat-models'
import { BaseGameLoaderError, GameLoader, GameLoadErrorType } from '../games/game-loader'
import { GameplayActivityRegistry } from '../games/gameplay-activity-registry'
import * as Lobbies from '../lobbies/lobby'
import logger from '../logging/logger'
import { getMapInfos } from '../maps/map-models'
import { reparseMapsAsNeeded } from '../maps/map-operations'
import filterChatMessage from '../messaging/filter-chat-message'
import { processMessageContents } from '../messaging/process-chat-message'
import { RestrictionService } from '../users/restriction-service'
import { findUsersById } from '../users/user-model'
import { Api, Mount, registerApiRoutes } from '../websockets/api-decorators'
import {
  ClientSocketsGroup,
  ClientSocketsManager,
  UserSocketsGroup,
  UserSocketsManager,
} from '../websockets/socket-groups'
import validateBody from '../websockets/validate-body'

const REMOVAL_TYPE_NORMAL = 0
const REMOVAL_TYPE_KICK = 1
const REMOVAL_TYPE_BAN = 2

const nonEmptyString = (str: unknown) => typeof str === 'string' && str.length > 0

const isValidTurnRate = (num: unknown) =>
  num === undefined || num === TURN_RATE_DYNAMIC || ALL_TURN_RATES.includes(num as BwTurnRate)

class Countdown extends Record({
  timer: undefined as Deferred<void> | undefined,
}) {}

class ListSubscription extends Record({
  onUnsubscribe: undefined as (() => void) | undefined,
  count: 0,
}) {}

function checkSubTypeValidity(gameType: GameType, gameSubType: number = 0, numSlots: number) {
  if (gameType === 'topVBottom') {
    if (gameSubType < 1 || gameSubType > numSlots - 1) {
      throw new errors.BadRequest('Invalid game sub-type')
    }
  } else if (gameType === 'teamMelee' || gameType === 'teamFfa') {
    if (gameSubType < 2 || gameSubType > Math.min(4, numSlots)) {
      throw new errors.BadRequest('Invalid game sub-type')
    }
  }
}

class CountdownCanceledError extends Error {}

const MOUNT_BASE = '/lobbies'

@Mount(MOUNT_BASE)
export class LobbyApi {
  readonly activityRegistry = container.resolve(GameplayActivityRegistry)
  readonly gameLoader = container.resolve(GameLoader)
  readonly restrictionService = container.resolve(RestrictionService)

  lobbies = Map<string, Lobby>()
  lobbyClients = Map<ClientSocketsGroup, string>()
  lobbyBannedUsers = Map<string, Set<SbUserId>>()
  lobbyCountdowns = Map<string, Countdown>()
  loadingLobbies = Set<string>()
  subscribedSockets = Map<string, ListSubscription>()

  constructor(
    readonly nydus: NydusServer,
    readonly userSockets: UserSocketsManager,
    readonly clientSockets: ClientSocketsManager,
  ) {
    this.clientSockets.on('newClient', client => {
      client.subscribe('/lobbiesCount', () => ({ count: this._getLobbiesCount() }))
    })
  }

  @Api('/subscribe')
  async subscribe(data: Map<string, any>, next: NextFunc) {
    const socket = data.get('client')
    if (this.subscribedSockets.has(socket.id)) {
      this.subscribedSockets = this.subscribedSockets.updateIn(
        [socket.id, 'count'],
        c => (c as number) + 1,
      )
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
  async unsubscribe(data: Map<string, any>, next: NextFunc) {
    const socket = data.get('client') as NydusClient
    if (!this.subscribedSockets.has(socket.id)) {
      throw new errors.Conflict('not subscribed')
    }

    const subscription = this.subscribedSockets.get(socket.id)!
    if (subscription.count === 1) {
      this.nydus.unsubscribeClient(socket, MOUNT_BASE)
      this.subscribedSockets = this.subscribedSockets.delete(socket.id)
      subscription.onUnsubscribe?.()
    } else {
      this.subscribedSockets = this.subscribedSockets.updateIn(
        [socket.id, 'count'],
        c => (c as number) - 1,
      )
    }
  }

  @Api(
    '/create',
    validateBody({
      name: isValidLobbyName,
      map: nonEmptyString,
      gameType: isValidGameType,
      gameSubType: isValidGameSubType,
      turnRate: isValidTurnRate,
      useLegacyLimits: (b: unknown) => b === undefined || b === true || b === false,
    }),
  )
  async create(data: Map<string, any>, next: NextFunc) {
    const { name, map, gameType, gameSubType, allowObservers, turnRate, useLegacyLimits } =
      data.get('body') as {
        name: string
        map: SbMapId
        gameType: GameType
        gameSubType?: number
        allowObservers?: boolean
        turnRate?: BwTurnRate
        useLegacyLimits?: boolean
      }
    const user = this.getUser(data)
    const client = this.getClient(data)

    if (!LOBBY_NAME_PATTERN.test(name)) {
      throw new errors.BadRequest('lobby name contains invalid characters')
    }

    if (this.lobbies.has(name)) {
      throw new errors.Conflict('already another lobby with that name')
    }

    let mapInfo = (await getMapInfos([map]))[0]
    if (!mapInfo) {
      throw new errors.BadRequest('invalid map')
    }
    ;[mapInfo] = await reparseMapsAsNeeded([mapInfo])
    checkSubTypeValidity(gameType, gameSubType, mapInfo.mapData.slots)

    let numSlots
    switch (gameType) {
      case 'oneVOne':
        // 1v1 mode always has 2 player slots
        numSlots = 2
        break
      case 'teamMelee':
      case 'teamFfa':
        // Team Melee and FFA always provide 8 player slots, divided amongst the teams evenly
        numSlots = 8
        break
      default:
        numSlots = mapInfo.mapData.slots
    }

    const lobby = Lobbies.createLobby({
      name,
      map: mapInfo,
      gameType,
      gameSubType: gameSubType ?? undefined,
      numSlots,
      hostUserId: client.userId,
      hostRace: undefined,
      allowObservers: allowObservers ?? false,
      turnRate,
      useLegacyLimits,
    })
    if (!this.activityRegistry.registerActiveClient(user.userId, client)) {
      throw new errors.Conflict('user is already active in a gameplay activity')
    }

    this.lobbies = this.lobbies.set(name, lobby)
    this.lobbyClients = this.lobbyClients.set(client, name)
    this._subscribeClientToLobby(lobby, user, client)

    this._publishListChange('add', Lobbies.toSummaryJson(lobby))
  }

  @Api(
    '/join',
    validateBody({
      name: isValidLobbyName,
    }),
  )
  async join(data: Map<string, any>, next: NextFunc) {
    const { name } = data.get('body') as { name: string }
    const user = this.getUser(data)
    const client = this.getClient(data)

    if (!this.lobbies.has(name)) {
      throw new errors.NotFound('no lobby found with that name')
    }
    const lobby = this.lobbies.get(name)!
    this.ensureLobbyNotTransient(lobby)

    if (
      this.lobbyBannedUsers.has(lobby.name) &&
      this.lobbyBannedUsers.get(lobby.name)!.includes(client.userId)
    ) {
      throw new errors.Conflict('user has been banned from this lobby')
    }

    const [teamIndex, slotIndex, availableSlot] = Lobbies.findAvailableSlot(lobby)
    if (teamIndex === undefined || slotIndex === undefined) {
      throw new errors.Conflict('lobby is full')
    }

    let player
    const [, observerTeam] = getObserverTeam(lobby)
    if (observerTeam && observerTeam.slots.find(s => s.id === availableSlot.id)) {
      player = Slots.createObserver(client.userId)
    } else {
      player = isUms(lobby.gameType)
        ? Slots.createHuman(
            client.userId,
            availableSlot.race,
            availableSlot.hasForcedRace,
            availableSlot.playerId,
          )
        : Slots.createHuman(client.userId)
    }

    let updated = Lobbies.addPlayer(lobby, teamIndex, slotIndex, player)

    if (!this.activityRegistry.registerActiveClient(user.userId, client)) {
      throw new errors.Conflict('user is already active in a gameplay activity')
    }

    // TODO(tec27): Fix map signing URL refreshing in a more general way, see #593
    const mapInfo = (await getMapInfos([lobby.map!.id]))[0]
    updated = updated.set('map', mapInfo)

    this.lobbies = this.lobbies.set(name, updated)
    this.lobbyClients = this.lobbyClients.set(client, name)

    this._publishLobbyDiff(lobby, updated)
    this._subscribeClientToLobby(lobby, user, client)
  }

  _subscribeClientToLobby(lobby: Lobby, user: UserSocketsGroup, client: ClientSocketsGroup) {
    const lobbyName = lobby.name
    client.subscribe(
      LobbyApi._getPath(lobby),
      async () => {
        const lobby = this.lobbies.get(lobbyName)
        if (!lobby) {
          return undefined
        }

        try {
          const userInfos = await findUsersById(
            getHumanSlots(lobby)
              .map(s => s.userId!)
              .toArray(),
          )

          return {
            type: 'init',
            lobby,
            userInfos,
          }
        } catch (err) {
          logger.error({ err }, 'error getting user infos for lobby init')
          return {
            type: 'init',
            lobby,
            // Generally this should be okay (the client can batch retrieve the user info later),
            // just higher latency
            userInfos: [],
          }
        }
      },
      client => {
        try {
          this._removeClientFromLobby(this.lobbies.get(lobbyName)!, client)
        } catch (err) {
          logger.warn({ err }, 'error removing client from lobby on disconnect')
        }
      },
    )
    user.subscribe(LobbyApi._getUserPath(lobby, user.userId), () => {
      return {
        type: 'status',
        lobby: Lobbies.toSummaryJson(this.lobbies.get(lobbyName)!),
      }
    })
    client.subscribe(LobbyApi._getClientPath(lobby, client))
  }

  @Api(
    '/sendChat',
    validateBody({
      text: nonEmptyString,
    }),
  )
  async sendChat(data: Map<string, any>, next: NextFunc) {
    const client = this.getClient(data)
    const lobby = this.getLobbyForClient(client)
    const time = Date.now()
    let { text } = data.get('body')

    const isChatRestricted = await this.restrictionService.isRestricted(
      client.userId,
      RestrictionKind.Chat,
    )
    if (isChatRestricted) {
      throw new errors.Forbidden('You are currently restricted from sending chat messages')
    }

    text = filterChatMessage(text)
    const [processedText, userMentions, channelMentions] = await processMessageContents(text)
    this._publishTo(lobby, {
      type: 'chat',
      message: {
        lobbyName: lobby.name,
        time,
        from: client.userId,
        text: processedText,
      },
      mentions: userMentions,
      channelMentions: channelMentions.map(c => toBasicChannelInfo(c)),
    })
  }

  @Api(
    '/addComputer',
    validateBody({
      slotId: nonEmptyString,
    }),
  )
  async addComputer(data: Map<string, any>, next: NextFunc) {
    const client = this.getClient(data)
    const lobby = this.getLobbyForClient(client)
    const [, , player] = findSlotByUserId(lobby, client.userId)
    this.ensureIsLobbyHost(lobby, player!)
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
    const updated = Lobbies.addPlayer(lobby, teamIndex!, slotIndex!, computer)
    this.lobbies = this.lobbies.set(lobby.name, updated)
    this._publishLobbyDiff(lobby, updated)
  }

  @Api(
    '/changeSlot',
    validateBody({
      slotId: nonEmptyString,
    }),
  )
  async changeSlot(data: Map<string, any>, next: NextFunc) {
    const client = this.getClient(data)
    const lobby = this.getLobbyForClient(client)
    this.ensureLobbyNotTransient(lobby)
    const [sourceTeamIndex, sourceSlotIndex, sourceSlot] = findSlotByUserId(lobby, client.userId)

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
      updated = Lobbies.movePlayerToSlot(
        lobby,
        sourceTeamIndex!,
        sourceSlotIndex!,
        destTeamIndex!,
        destSlotIndex!,
      )
    } catch (err) {
      throw new errors.BadRequest((err as any).message)
    }
    this.lobbies = this.lobbies.set(lobby.name, updated)
    this._publishLobbyDiff(lobby, updated)
  }

  @Api(
    '/setRace',
    validateBody({
      id: nonEmptyString,
      race: validRace,
    }),
  )
  async setRace(data: Map<string, any>, next: NextFunc) {
    const client = this.getClient(data)
    const lobby = this.getLobbyForClient(client)
    this.ensureLobbyNotLoading(lobby)
    const [, , player] = findSlotByUserId(lobby, client.userId)

    const { id, race } = data.get('body')
    const [teamIndex, slotIndex, slotToSetRace] = findSlotById(lobby, id)
    if (!slotToSetRace) {
      throw new errors.BadRequest('invalid id')
    }
    if (
      slotToSetRace.type !== 'computer' &&
      slotToSetRace.type !== 'human' &&
      slotToSetRace.type !== 'controlledOpen' &&
      slotToSetRace.type !== 'controlledClosed'
    ) {
      throw new errors.BadRequest('invalid slot type')
    }

    if (slotToSetRace.type === 'computer') {
      this.ensureIsLobbyHost(lobby, player!)
    } else if (slotToSetRace.controlledBy) {
      if (slotToSetRace.controlledBy !== player!.id) {
        throw new errors.Forbidden('must control a slot to set its race')
      }
    } else if (slotToSetRace.id !== player!.id) {
      throw new errors.Forbidden("cannot set other user's races")
    } else if (slotToSetRace.hasForcedRace) {
      throw new errors.Forbidden('this slot has a forced race and cannot be changed')
    }

    const updatedLobby = Lobbies.setRace(lobby, teamIndex!, slotIndex!, race)
    this.lobbies = this.lobbies.set(lobby.name, updatedLobby)
    this._publishLobbyDiff(lobby, updatedLobby)
  }

  @Api(
    '/openSlot',
    validateBody({
      slotId: nonEmptyString,
    }),
  )
  async openSlot(data: Map<string, any>, next: NextFunc) {
    const client = this.getClient(data)
    const lobby = this.getLobbyForClient(client)
    const [, , player] = findSlotByUserId(lobby, client.userId)
    this.ensureIsLobbyHost(lobby, player!)
    this.ensureLobbyNotTransient(lobby)

    const { slotId } = data.get('body')
    const [teamIndex, slotIndex, slotToOpen] = findSlotById(lobby, slotId)
    if (!slotToOpen) {
      throw new errors.BadRequest('invalid slot id')
    }
    if (
      slotToOpen.type === 'open' ||
      slotToOpen.type === 'controlledOpen' ||
      slotToOpen.type === 'umsComputer'
    ) {
      throw new errors.BadRequest('invalid slot type')
    }

    let updated
    try {
      updated = Lobbies.openSlot(lobby, teamIndex!, slotIndex!)
    } catch (err) {
      throw new errors.BadRequest((err as any).message)
    }

    this.lobbies = this.lobbies.set(lobby.name, updated)
    this._publishLobbyDiff(lobby, updated)
  }

  @Api(
    '/closeSlot',
    validateBody({
      slotId: nonEmptyString,
    }),
  )
  async closeSlot(data: Map<string, any>, next: NextFunc) {
    const user = this.getUser(data)
    const client = this.getClient(data)
    const lobby = this.getLobbyForClient(client)
    const [, , player] = findSlotByUserId(lobby, client.userId)
    this.ensureIsLobbyHost(lobby, player!)
    this.ensureLobbyNotTransient(lobby)

    const { slotId } = data.get('body')
    const [teamIndex, slotIndex, slotToClose] = findSlotById(lobby, slotId)
    if (!slotToClose) {
      throw new errors.BadRequest('invalid slot id')
    }

    if (
      slotToClose.type === 'closed' ||
      slotToClose.type === 'controlledClosed' ||
      slotToClose.type === 'umsComputer'
    ) {
      throw new errors.BadRequest('invalid slot type')
    }

    if (
      slotToClose.type === 'human' ||
      slotToClose.type === 'computer' ||
      slotToClose.type === 'observer'
    ) {
      this._kickPlayerFromLobby(lobby, user, teamIndex!, slotIndex!, slotToClose)
    }
    const afterKick = this.lobbies.get(lobby.name)!

    let updated
    try {
      updated = Lobbies.closeSlot(afterKick, teamIndex!, slotIndex!)
    } catch (err) {
      throw new errors.BadRequest((err as any).message)
    }
    this.lobbies = this.lobbies.set(lobby.name, updated)
    this._publishLobbyDiff(afterKick, updated)
  }

  @Api('/kickPlayer')
  async kickPlayer(data: Map<string, any>, next: NextFunc) {
    const user = this.getUser(data)
    const client = this.getClient(data)
    const lobby = this.getLobbyForClient(client)
    const [, , player] = findSlotByUserId(lobby, client.userId)
    this.ensureIsLobbyHost(lobby, player!)
    this.ensureLobbyNotTransient(lobby)

    const { slotId } = data.get('body')
    const [teamIndex, slotIndex, playerToKick] = findSlotById(lobby, slotId)
    if (!playerToKick) {
      throw new errors.BadRequest('invalid slot id')
    }
    if (
      playerToKick.type !== 'human' &&
      playerToKick.type !== 'computer' &&
      playerToKick.type !== 'observer'
    ) {
      throw new errors.BadRequest('invalid slot type')
    }

    this._kickPlayerFromLobby(lobby, user, teamIndex!, slotIndex!, playerToKick)
  }

  _kickPlayerFromLobby(
    lobby: Lobby,
    user: UserSocketsGroup,
    teamIndex: number,
    slotIndex: number,
    playerToKick: Slot,
  ) {
    if (playerToKick.type === 'computer') {
      // NOTE(tec27): We know that removing a computer can never result in an empty lobby since a
      // human has to do it
      const updated = Lobbies.removePlayer(lobby, teamIndex, slotIndex, playerToKick)!
      this.lobbies = this.lobbies.set(lobby.name, updated)
      this._publishLobbyDiff(lobby, updated)
    } else if (playerToKick.type === 'human' || playerToKick.type === 'observer') {
      const client = this.activityRegistry.getClientForUser(playerToKick.userId!)
      if (!client) {
        throw new errors.Conflict('target player has no active client')
      }
      this._removeClientFromLobby(lobby, client, REMOVAL_TYPE_KICK)
    }
  }

  @Api('/banPlayer')
  async banPlayer(data: Map<string, any>, next: NextFunc) {
    const client = this.getClient(data)
    const lobby = this.getLobbyForClient(client)
    const [, , player] = findSlotByUserId(lobby, client.userId)
    this.ensureIsLobbyHost(lobby, player!)
    this.ensureLobbyNotTransient(lobby)

    const { slotId } = data.get('body')
    const [, , playerToBan] = findSlotById(lobby, slotId)
    if (!playerToBan) {
      throw new errors.BadRequest('invalid slot id')
    }
    if (playerToBan.type !== 'human' && playerToBan.type !== 'observer') {
      throw new errors.BadRequest('invalid slot type')
    }

    this.lobbyBannedUsers = this.lobbyBannedUsers.update(lobby.name, Set(), val =>
      val.add(playerToBan.userId!),
    )

    const clientToBan = this.activityRegistry.getClientForUser(playerToBan.userId!)
    if (!clientToBan) {
      throw new errors.Conflict('target player has no active client')
    }
    this._removeClientFromLobby(lobby, clientToBan, REMOVAL_TYPE_BAN)
  }

  @Api('/makeObserver')
  async makeObserver(data: Map<string, any>, next: NextFunc) {
    const client = this.getClient(data)
    const lobby = this.getLobbyForClient(client)
    const [, , player] = findSlotByUserId(lobby, client.userId)
    this.ensureIsLobbyHost(lobby, player!)
    this.ensureLobbyNotTransient(lobby)

    const { slotId } = data.get('body')
    const [teamIndex, slotIndex, slot] = findSlotById(lobby, slotId)
    if (!slot) {
      throw new errors.BadRequest('invalid slot id')
    }

    let updated
    try {
      updated = Lobbies.makeObserver(lobby, teamIndex!, slotIndex!)
    } catch (err) {
      throw new errors.BadRequest((err as any).message)
    }
    this.lobbies = this.lobbies.set(lobby.name, updated)
    this._publishLobbyDiff(lobby, updated, undefined, undefined, slotIndex)
  }

  @Api('/removeObserver')
  async removeObserver(data: Map<string, any>, next: NextFunc) {
    const client = this.getClient(data)
    const lobby = this.getLobbyForClient(client)
    const [, , player] = findSlotByUserId(lobby, client.userId)
    this.ensureIsLobbyHost(lobby, player!)
    this.ensureLobbyNotTransient(lobby)

    const { slotId } = data.get('body')
    const [teamIndex, slotIndex, slot] = findSlotById(lobby, slotId)
    if (!slot) {
      throw new errors.BadRequest('invalid slot id')
    }
    if (!lobby.teams.get(teamIndex!)?.isObserver) {
      throw new errors.BadRequest('Slot is not in the observer team')
    }

    let updated
    try {
      updated = Lobbies.removeObserver(lobby, slotIndex!)
    } catch (err) {
      throw new errors.BadRequest((err as any).message)
    }
    this.lobbies = this.lobbies.set(lobby.name, updated)
    this._publishLobbyDiff(lobby, updated, undefined, undefined, slotIndex)
  }

  @Api('/leave')
  async leave(data: Map<string, any>, next: NextFunc) {
    const user = this.getUser(data)
    const client = this.getActiveClientForUser(user.userId)
    const lobby = this.getLobbyForClient(client)
    this._removeClientFromLobby(lobby, client)
  }

  _removeClientFromLobby(
    lobby: Lobby,
    client: ClientSocketsGroup,
    removalType = REMOVAL_TYPE_NORMAL,
  ) {
    const [teamIndex, slotIndex, player] = findSlotByUserId(lobby, client.userId)
    const updatedLobby = Lobbies.removePlayer(lobby, teamIndex!, slotIndex!, player!)
    const isLobbyEmpty = !updatedLobby

    if (isLobbyEmpty) {
      // The lobby is now empty and needs to be removed from the list

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
      this._publishLobbyDiff(
        lobby,
        updatedLobby,
        removalType === REMOVAL_TYPE_KICK ? client.userId : undefined,
        removalType === REMOVAL_TYPE_BAN ? client.userId : undefined,
      )
    }
    this.lobbyClients = this.lobbyClients.delete(client)
    this.activityRegistry.unregisterClientForUser(client.userId)

    this._publishToUser(lobby, client.userId, {
      type: 'status',
      lobby: null,
    })

    this._maybeCancelCountdown(lobby, isLobbyEmpty)
    this._maybeCancelLoading(lobby, isLobbyEmpty)

    try {
      const user = this.getUserById(client.userId)
      user.unsubscribe(LobbyApi._getUserPath(lobby, client.userId))
    } catch {
      // Getting the user can fail if they've gone offline, but we don't need to unsubscribe
      // them in that case, so ignoring this error is fine
    }
    client.unsubscribe(LobbyApi._getClientPath(lobby, client))
    client.unsubscribe(LobbyApi._getPath(lobby))
  }

  @Api('/startCountdown')
  async startCountdown(data: Map<string, any>, next: NextFunc) {
    const client = this.getClient(data)
    const lobby = this.getLobbyForClient(client)
    if (!hasOpposingSides(lobby)) {
      throw new errors.BadRequest('must have at least 2 opposing sides')
    }

    const [, , player] = findSlotByUserId(lobby, client.userId)
    this.ensureIsLobbyHost(lobby, player!)
    this.ensureLobbyNotTransient(lobby)

    const lobbyName = lobby.name
    const countdownTimer = createDeferred<void>()
    countdownTimer.catch(swallowNonBuiltins)
    setTimeout(() => countdownTimer.resolve(), 5000)
    this.lobbyCountdowns = this.lobbyCountdowns.set(
      lobbyName,
      new Countdown({ timer: countdownTimer }),
    )

    this._publishTo(lobby, { type: 'startCountdown' })
    this._publishListChange('delete', lobby.name)

    const gameConfig: GameConfig = {
      gameType: lobby.gameType,
      gameSubType: lobby.gameSubType,
      gameSource: GameSource.Lobby,
      gameSourceExtra: {
        host: lobby.host.userId,
        turnRate: lobby.turnRate,
        useLegacyLimits: lobby.useLegacyLimits,
      },
      // TODO(tec27): Add observers into this config somewhere? Right now we store no record that
      // they were there
      teams: lobby.teams
        .map(team =>
          team.slots
            .filter(s => s.type === 'human' || s.type === 'computer' || s.type === 'umsComputer')
            .map(s => ({
              id: s.userId ?? makeSbUserId(0),
              race: s.race,
              isComputer: s.type === 'computer' || s.type === 'umsComputer',
            }))
            .toArray(),
        )
        .toArray(),
    }

    let usersAtFault: SbUserId[] | undefined
    try {
      await countdownTimer
      this.lobbyCountdowns = this.lobbyCountdowns.delete(lobbyName)
      this.loadingLobbies = this.loadingLobbies.add(lobbyName)

      const gameLoadResult = await this.gameLoader.loadGame({
        players: getHumanSlots(lobby),
        playerInfos: getPlayerInfos(lobby),
        mapId: lobby.map!.id,
        gameConfig,
      })

      if (gameLoadResult.isError()) {
        switch (gameLoadResult.error.code) {
          case GameLoadErrorType.PlayerFailed:
            usersAtFault = [gameLoadResult.error.data.userId]
            break
          case GameLoadErrorType.Timeout:
            usersAtFault = gameLoadResult.error.data.unloaded
            break
          case GameLoadErrorType.Canceled:
          case GameLoadErrorType.Internal:
            break
          default:
            gameLoadResult.error satisfies never
        }
        // Just use the catch below to handle this error
        throw gameLoadResult.error
      }

      this._onGameLoaded(lobby)
    } catch (err) {
      if (err instanceof BaseGameLoaderError) {
        if (err.code === GameLoadErrorType.Internal) {
          logger.error({ err }, 'error loading game for lobby')
        }
      } else if (!(err instanceof CountdownCanceledError)) {
        logger.error({ err }, 'unexpected error while loading game for lobby')
      }

      // NOTE(tec27): This is valid to do only because we prevent changes to the lobby contents
      // once countdown/loading starts. I think a better implementation would be to add a stored
      // AbortSignal that we abort if a lobby is closed, but that's a more involved change atm.
      if (this.lobbies.get(lobby.name) === lobby) {
        // This has been verified to be the same lobby, so sending cancel events is safe
        this._maybeCancelCountdown(lobby, false)
        this._maybeCancelLoading(lobby, false, usersAtFault)
      }
    }
  }

  _maybeCancelLoading(lobby: Lobby, isLobbyEmpty = false, usersAtFault?: SbUserId[]) {
    if (!this.loadingLobbies.has(lobby.name)) {
      // This lobby was closed before loading completed, likely because all the human users left or
      // disconnected.
      return
    }

    this.loadingLobbies = this.loadingLobbies.delete(lobby.name)
    this._publishTo(lobby, {
      type: 'cancelLoading',
      usersAtFault,
    })
    if (!isLobbyEmpty) {
      this._publishListChange('add', Lobbies.toSummaryJson(lobby))
    }
  }

  _onGameLoaded(lobby: Lobby) {
    this._publishTo(lobby, { type: 'gameStarted' })

    getHumanSlots(lobby)
      .map(p => this.activityRegistry.getClientForUser(p.userId!)!)
      .forEach(client => {
        const user = this.getUserById(client.userId)
        this._publishToUser(lobby, user.userId, {
          type: 'status',
          lobby: null,
        })
        user.unsubscribe(LobbyApi._getUserPath(lobby, user.userId))
        client.unsubscribe(LobbyApi._getPath(lobby))
        client.unsubscribe(LobbyApi._getClientPath(lobby, client))
        this.lobbyClients = this.lobbyClients.delete(client)
        this.activityRegistry.unregisterClientForUser(user.userId)
      })
    this.lobbies = this.lobbies.delete(lobby.name)
    this.lobbyBannedUsers = this.lobbyBannedUsers.delete(lobby.name)
    this.loadingLobbies = this.loadingLobbies.delete(lobby.name)
  }

  // Cancels the countdown if one was occurring (no-op if it was not)
  _maybeCancelCountdown(lobby: Lobby, isLobbyEmpty = false) {
    if (!this.lobbyCountdowns.has(lobby.name)) {
      return
    }

    const countdown = this.lobbyCountdowns.get(lobby.name)
    countdown?.timer?.reject(new CountdownCanceledError('Countdown cancelled'))
    this.lobbyCountdowns = this.lobbyCountdowns.delete(lobby.name)
    this._publishTo(lobby, {
      type: 'cancelCountdown',
    })
    if (!isLobbyEmpty) {
      this._publishListChange('add', Lobbies.toSummaryJson(lobby))
    }
  }

  @Api(
    '/getLobbyState',
    validateBody({
      lobbyName: nonEmptyString,
    }),
  )
  async getLobbyState(data: Map<string, any>, next: NextFunc) {
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

  getUser(data: Map<string, any>): UserSocketsGroup {
    const user = this.userSockets.getBySocket(data.get('client'))
    if (!user) throw new errors.Unauthorized('authorization required')
    return user
  }

  getUserById(id: SbUserId): UserSocketsGroup {
    const user = this.userSockets.getById(id)
    if (!user) throw new errors.BadRequest('user not online')
    return user
  }

  getActiveClientForUser(userId: SbUserId): ClientSocketsGroup {
    const client = this.activityRegistry.getClientForUser(userId)
    if (!client) throw new errors.BadRequest('no active client for user')
    return client
  }

  getClient(data: Map<string, any>): ClientSocketsGroup {
    const client = this.clientSockets.getCurrentClient(data.get('client'))
    if (!client) throw new errors.Unauthorized('authorization required')
    return client
  }

  getLobbyForClient(client: ClientSocketsGroup): Lobby {
    if (!this.lobbyClients.has(client)) {
      throw new errors.BadRequest('must be in a lobby')
    }
    return this.lobbies.get(this.lobbyClients.get(client)!)!
  }

  ensureIsLobbyHost(lobby: Lobby, player: Slot) {
    if (player.id !== lobby.host.id) {
      throw new errors.Unauthorized('must be a lobby host')
    }
  }

  ensureLobbyNotLoading(lobby: Lobby) {
    if (this.loadingLobbies.has(lobby.name)) {
      throw new errors.Conflict('lobby has already started')
    }
  }

  // Ensures that the lobby is not in a 'transient' state, that is, a state between being a lobby
  // and being an active game (counting down, loading, etc.). Transient states can be rolled back
  // (bringing the lobby back to a non-transient state)
  ensureLobbyNotTransient(lobby: Lobby) {
    if (this.lobbyCountdowns.has(lobby.name)) {
      throw new errors.Conflict('lobby is counting down')
    }
    if (this.loadingLobbies.has(lobby.name)) {
      throw new errors.Conflict('lobby has already started')
    }
  }

  _getLobbiesCount() {
    // TODO(tec27): Ideally this would remove full lobbies?
    return Math.max(this.lobbies.size - (this.lobbyCountdowns.size + this.loadingLobbies.size), 0)
  }

  _publishLobbiesCount() {
    this.nydus.publish('/lobbiesCount', { count: this._getLobbiesCount() })
  }

  _publishListChange(action: 'add' | 'delete' | 'update', summary: LobbySummaryJson | string) {
    this.nydus.publish(MOUNT_BASE, { action, payload: summary })
    this._publishLobbiesCount()
  }

  _publishTo(lobby: Lobby, data?: any) {
    this.nydus.publish(LobbyApi._getPath(lobby), data)
  }

  _publishToUser(lobby: Lobby, userId: SbUserId, data?: any) {
    this.nydus.publish(LobbyApi._getUserPath(lobby, userId), data)
  }

  _publishToClient(lobby: Lobby, userId: SbUserId, data?: any) {
    const client = this.activityRegistry.getClientForUser(userId)
    if (!client) {
      return
    }
    this.nydus.publish(LobbyApi._getClientPath(lobby, client), data)
  }

  _publishLobbyDiff(
    oldLobby: Lobby,
    newLobby: Lobby,
    kickedUser?: SbUserId,
    bannedUser?: SbUserId,
    deletedSlotIndex?: number,
  ) {
    if (oldLobby === newLobby) return

    const diffEvents = []
    if (newLobby.host.id !== oldLobby.host.id) {
      diffEvents.push({
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

    const oldIdSlots = Map<string, [teamIndex: number, slotIndex: number, slot: Slot]>(
      getLobbySlotsWithIndexes(oldLobby).map(([teamIndex, slotIndex, slot]) => [
        slot.id,
        [teamIndex, slotIndex, slot],
      ]),
    )
    const newIdSlots = Map<string, [teamIndex: number, slotIndex: number, slot: Slot]>(
      getLobbySlotsWithIndexes(newLobby).map(([teamIndex, slotIndex, slot]) => [
        slot.id,
        [teamIndex, slotIndex, slot],
      ]),
    )

    for (const id of left.values()) {
      // These are the human slots that have left the lobby or were removed. Note that every `leave`
      // operation also triggers a `slotCreate` operation, which means that we don't have to set
      // slots on the client-side in response to this operation (since they'll be overriden in the
      // `slotCreate` operation below anyways). This also means we only care about `human` slots
      // leaving just so we can display appropriate message in the lobby.
      const [, , player] = oldIdSlots.get(id)!
      if (kickedUser === player.userId) {
        diffEvents.push({
          type: 'kick',
          player,
        })
      } else if (bannedUser === player.userId) {
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

    // Check for deleted slots caused by obs slot creation/removal.
    // In order for things on client to work properly, we need to tell them exactly *which* slot was
    // deleted, which seems to be impossible to figure out just by comparing lobby diffs. So in a
    // similar fashion as we do when determining if the user was kicked/banned, we pass the slot
    // index of a deleted slot from the method that knows which slot it is
    for (let teamIndex = 0; teamIndex < oldLobby.teams.size; teamIndex += 1) {
      const oldTeam = oldLobby.teams.get(teamIndex)!
      const newTeam = newLobby.teams.get(teamIndex)!
      if (oldTeam.slots.size > newTeam.slots.size) {
        diffEvents.push({
          type: 'slotDeleted',
          teamIndex,
          slotIndex: deletedSlotIndex,
        })
      }
    }

    for (const id of created.values()) {
      // These are all of the slots that were created in the new lobby compared to the old one. This
      // includes the slots that were created as a result of players leaving the lobby, moving to a
      // different slot, open/closing a slot, etc.
      const [teamIndex, slotIndex, slot] = newIdSlots.get(id)!
      const slotCreatedEvent: LobbySlotCreateEvent = {
        type: 'slotCreate',
        teamIndex,
        slotIndex,
        slot,
      }

      // TODO(tec27): Ideally we would communicate the SbUser struct for any new users, but it's a
      // bit of a pain to retrieve here. Deal with this in a better way when this service has been
      // restructured

      diffEvents.push(slotCreatedEvent)
    }

    for (const id of same.values()) {
      const [oldTeamIndex, oldSlotIndex, oldSlot] = oldIdSlots.get(id)!
      const [newTeamIndex, newSlotIndex, newSlot] = newIdSlots.get(id)!

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

  static _getPath(lobby: Lobby) {
    return MOUNT_BASE + urlPath`/${lobby.name}`
  }

  static _getUserPath(lobby: Lobby, userId: SbUserId) {
    return MOUNT_BASE + urlPath`/${lobby.name}/${userId}`
  }

  static _getClientPath(lobby: Lobby, client: ClientSocketsGroup) {
    return MOUNT_BASE + urlPath`/${lobby.name}/${client.userId}/${client.clientId}`
  }
}

export default function registerApi(
  nydus: NydusServer,
  userSockets: UserSocketsManager,
  clientSockets: ClientSocketsManager,
) {
  const api = new LobbyApi(nydus, userSockets, clientSockets)
  registerApiRoutes(api, nydus)
  return api
}
