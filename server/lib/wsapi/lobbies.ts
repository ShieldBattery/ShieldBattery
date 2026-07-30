import errors from 'http-errors'
import { Map, Record, Set } from 'immutable'
import { NextFunc, NydusClient, NydusServer } from 'nydus'
import { container } from 'tsyringe'
import { ReadonlyDeep } from 'type-fest'
import createDeferred, { Deferred } from '../../../common/async/deferred'
import swallowNonBuiltins from '../../../common/async/swallow-non-builtins'
import { isValidLobbyName, validRace } from '../../../common/constants'
import { GameServerRegion, GameServerRegionId } from '../../../common/game-server-regions'
import { GameConfig, GameSource } from '../../../common/games/configuration'
import { GameType, isValidGameSubType, isValidGameType } from '../../../common/games/game-type'
import {
  ALL_LOBBY_VISIBILITIES,
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
  LobbyVisibility,
} from '../../../common/lobbies'
import {
  LobbyCreateErrorCode,
  LobbyJoinErrorCode,
  LobbySlotCreateEvent,
} from '../../../common/lobbies/lobby-network'
import { SbLobbyId } from '../../../common/lobbies/sb-lobby-id'
import * as Slots from '../../../common/lobbies/slot'
import { Slot, SlotType } from '../../../common/lobbies/slot'
import { SbMapId } from '../../../common/maps'
import { isPrettyId } from '../../../common/pretty-id'
import { urlPath } from '../../../common/urls'
import { RestrictionKind } from '../../../common/users/restrictions'
import { makeSbUserId, SbUserId } from '../../../common/users/sb-user-id'
import { toBasicChannelInfo } from '../chat/chat-models'
import { GameServerRegionsService } from '../game-server-regions/game-server-regions-service'
import { BaseGameLoaderError, GameLoader, GameLoadErrorType } from '../games/game-loader'
import { GameplayActivityRegistry } from '../games/gameplay-activity-registry'
import * as Lobbies from '../lobbies/lobby'
import { setLobbySummaryGetter } from '../lobbies/lobby-summaries'
import logger from '../logging/logger'
import { getMapInfos } from '../maps/map-models'
import { reparseMapsAsNeeded } from '../maps/map-operations'
import filterChatMessage from '../messaging/filter-chat-message'
import { processMessageContents } from '../messaging/process-chat-message'
import { NetcodeV2Service } from '../netcode-v2/netcode-v2-service'
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
import { LobbyPlayerNetworkStore } from './lobby-player-network-store'

const REMOVAL_TYPE_NORMAL = 0
const REMOVAL_TYPE_KICK = 1
const REMOVAL_TYPE_BAN = 2

const nonEmptyString = (str: unknown) => typeof str === 'string' && str.length > 0
const isLobbyId = (id: unknown) => typeof id === 'string' && isPrettyId(id)

// The desired region is an opaque id, loosely validated here; the handler checks it against the
// live region list and drops it if unknown, so a client with no measured regions joins region-less.
const isValidRegion = (region: unknown) =>
  region === undefined || (typeof region === 'string' && region.length > 0 && region.length <= 64)
// `rttMs` is only meaningful alongside a region; the region list check is what actually gates it.
const isValidRttMs = (rttMs: unknown) =>
  rttMs === undefined || (typeof rttMs === 'number' && rttMs >= 0)
// The per-session netcode v2 public key is optional here (a solo-vs-AI lobby never uses netcode v2),
// but when present it must decode to exactly 32 raw bytes (an Ed25519 public key).
const isValidNetcodeV2Pubkey = (pubkey: unknown) =>
  pubkey === undefined ||
  (typeof pubkey === 'string' && Buffer.from(pubkey, 'base64').length === 32)
const isValidVisibility = (visibility: unknown) =>
  visibility === undefined || ALL_LOBBY_VISIBILITIES.includes(visibility as LobbyVisibility)

/**
 * Returns `region` only when it appears in `regions`, otherwise undefined. The region list can
 * change between a client fetching it and joining, so an unknown (or absent) region degrades to
 * undefined — the occupant's slot is then placed region-blind at session create rather than the
 * join being rejected.
 */
export function knownRegionOrUndefined(
  region: GameServerRegionId | undefined,
  regions: ReadonlyDeep<GameServerRegion[]>,
): GameServerRegionId | undefined {
  return region !== undefined && regions.some(r => r.id === region) ? region : undefined
}

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
  readonly gameServerRegionsService = container.resolve(GameServerRegionsService)
  readonly netcodeV2Service = container.resolve(NetcodeV2Service)

  lobbies = Map<SbLobbyId, Lobby>()
  lobbyClients = Map<ClientSocketsGroup, SbLobbyId>()
  lobbyBannedUsers = Map<SbLobbyId, Set<SbUserId>>()
  lobbyCountdowns = Map<SbLobbyId, Countdown>()
  loadingLobbies = Map<SbLobbyId, AbortController>()
  subscribedSockets = Map<string, ListSubscription>()
  readonly lobbyPlayerNetwork = new LobbyPlayerNetworkStore()

  constructor(
    readonly nydus: NydusServer,
    readonly userSockets: UserSocketsManager,
    readonly clientSockets: ClientSocketsManager,
  ) {
    this.clientSockets.on('newClient', client => {
      client.subscribe('/lobbiesCount', () => ({ count: this._getLobbiesCount() }))
    })

    // Registers this instance's registry as the source of truth for `lobby-summaries`'s seam, so
    // the unauthenticated HTTP summary endpoint and the lobby page-metadata resolver can read a
    // live lobby's summary without importing this websocket API directly.
    setLobbySummaryGetter(id => {
      const lobby = this.lobbies.get(id)
      // A counting-down or loading lobby can't be joined, so it's reported as gone rather than as
      // an open lobby with slots available.
      if (!lobby || this.lobbyCountdowns.has(id) || this.loadingLobbies.has(id)) {
        return undefined
      }
      return Lobbies.toSummaryJson(lobby)
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

    const summary = this.lobbies
      .valueSeq()
      .filter(l => l.visibility === 'listed')
      .map(l => Lobbies.toSummaryJson(l))
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
      allowObservers: (b: unknown) => b === undefined || b === true || b === false,
      useLegacyLimits: (b: unknown) => b === undefined || b === true || b === false,
      visibility: isValidVisibility,
      region: isValidRegion,
      rttMs: isValidRttMs,
      clientPubkey: isValidNetcodeV2Pubkey,
    }),
  )
  async create(data: Map<string, any>, next: NextFunc) {
    const {
      name,
      map,
      gameType,
      gameSubType,
      allowObservers,
      useLegacyLimits,
      visibility,
      region,
      rttMs,
      clientPubkey,
    } = data.get('body') as {
      name: string
      map: SbMapId
      gameType: GameType
      gameSubType?: number
      allowObservers?: boolean
      useLegacyLimits?: boolean
      visibility?: LobbyVisibility
      region?: GameServerRegionId
      rttMs?: number
      clientPubkey?: string
    }
    const user = this.getUser(data)
    const client = this.getClient(data)

    const hostRegion = await this._resolveRegion(region)

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

    const lobbyVisibility = visibility ?? 'listed'

    // This check must not be separated from the inserts below by an await, or two in-flight
    // creates with the same name could both pass it.
    // Name uniqueness only applies among listed lobbies: an unlisted lobby must never influence a
    // publicly-observable outcome (a NameTaken error would reveal its existence), and names are
    // display-only, so duplicates outside the public list are harmless.
    if (
      lobbyVisibility === 'listed' &&
      this.lobbies.some(l => l.visibility === 'listed' && l.name === name)
    ) {
      throw Object.assign(new errors.Conflict('already another lobby with that name'), {
        body: { code: LobbyCreateErrorCode.NameTaken },
      })
    }

    const lobby = Lobbies.createLobby({
      name,
      map: mapInfo,
      gameType,
      gameSubType: gameSubType ?? undefined,
      numSlots,
      hostUserId: client.userId,
      hostRace: undefined,
      hostRegion,
      allowObservers: allowObservers ?? false,
      useLegacyLimits,
      visibility: lobbyVisibility,
    })
    if (!this.activityRegistry.registerActiveClient(user.userId, client)) {
      throw new errors.Conflict('user is already active in a gameplay activity')
    }

    this.lobbies = this.lobbies.set(lobby.id, lobby)
    this.lobbyClients = this.lobbyClients.set(client, lobby.id)
    if (rttMs !== undefined || clientPubkey !== undefined) {
      this.lobbyPlayerNetwork.set(lobby.id, client.userId, { rttMs, netcodeV2Pubkey: clientPubkey })
    }
    this._subscribeClientToLobby(lobby, user, client)

    this._publishListChange('add', lobby)
    this._warmLobbyRegions(lobby)

    return { id: lobby.id }
  }

  @Api(
    '/join',
    validateBody({
      id: isLobbyId,
      region: isValidRegion,
      rttMs: isValidRttMs,
      clientPubkey: isValidNetcodeV2Pubkey,
    }),
  )
  async join(data: Map<string, any>, next: NextFunc) {
    const { id, region, rttMs, clientPubkey } = data.get('body') as {
      id: SbLobbyId
      region?: GameServerRegionId
      rttMs?: number
      clientPubkey?: string
    }
    const user = this.getUser(data)
    const client = this.getClient(data)

    const joinRegion = await this._resolveRegion(region)

    if (!this.lobbies.has(id)) {
      throw Object.assign(new errors.NotFound('no lobby found with that id'), {
        body: { code: LobbyJoinErrorCode.NoLongerOpen },
      })
    }
    const lobby = this.lobbies.get(id)!
    try {
      this.ensureLobbyNotTransient(lobby)
    } catch (err) {
      throw Object.assign(err as Error, { body: { code: LobbyJoinErrorCode.AlreadyStarted } })
    }

    if (
      this.lobbyBannedUsers.has(lobby.id) &&
      this.lobbyBannedUsers.get(lobby.id)!.includes(client.userId)
    ) {
      throw Object.assign(new errors.Conflict('user has been banned from this lobby'), {
        body: { code: LobbyJoinErrorCode.Banned },
      })
    }

    const [teamIndex, slotIndex, availableSlot] = Lobbies.findAvailableSlot(lobby)
    if (teamIndex === undefined || slotIndex === undefined) {
      throw Object.assign(new errors.Conflict('lobby is full'), {
        body: { code: LobbyJoinErrorCode.Full },
      })
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
    player = player.set('region', joinRegion)

    let updated = Lobbies.addPlayer(lobby, teamIndex, slotIndex, player)

    if (!this.activityRegistry.registerActiveClient(user.userId, client)) {
      throw Object.assign(new errors.Conflict('user is already active in a gameplay activity'), {
        body: { code: LobbyJoinErrorCode.AlreadyInActivity },
      })
    }

    // TODO(tec27): Fix map signing URL refreshing in a more general way, see #593
    const mapInfo = (await getMapInfos([lobby.map!.id]))[0]
    updated = updated.set('map', mapInfo)

    this.lobbies = this.lobbies.set(id, updated)
    this.lobbyClients = this.lobbyClients.set(client, id)
    if (rttMs !== undefined || clientPubkey !== undefined) {
      this.lobbyPlayerNetwork.set(id, client.userId, { rttMs, netcodeV2Pubkey: clientPubkey })
    }

    this._publishLobbyDiff(lobby, updated)
    this._subscribeClientToLobby(lobby, user, client)
    this._warmLobbyRegions(updated)
  }

  /**
   * Validates a client-reported desired region against the live region list, returning it only if
   * it still exists (the list can change between the client fetching it and joining). An absent or
   * unknown region resolves to undefined so the occupant's slot is placed region-blind at session
   * create — mirroring the matchmaking queue's region gate.
   */
  private async _resolveRegion(
    region: GameServerRegionId | undefined,
  ): Promise<GameServerRegionId | undefined> {
    if (region === undefined) {
      // A client with no measured/configured regions reports none; skip the region-list round trip.
      return undefined
    }
    return knownRegionOrUndefined(region, await this.gameServerRegionsService.getRegions())
  }

  /**
   * Signals the coordinator to keep every region occupied by a human slot in this lobby warm, so a
   * game server is ready by the time the lobby launches. Best-effort and debounced downstream, so
   * it's safe to call on every occupancy change.
   */
  _warmLobbyRegions(lobby: Lobby) {
    const regions = getHumanSlots(lobby)
      .map(slot => slot.region)
      .filter((region): region is GameServerRegionId => region !== undefined)
      .toSet()
      .toArray()
    if (regions.length > 0) {
      this.netcodeV2Service.warmRegions(regions)
    }
  }

  _subscribeClientToLobby(lobby: Lobby, user: UserSocketsGroup, client: ClientSocketsGroup) {
    const lobbyId = lobby.id
    client.subscribe(
      LobbyApi._getPath(lobby),
      async () => {
        const lobby = this.lobbies.get(lobbyId)
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
          this._removeClientFromLobby(this.lobbies.get(lobbyId)!, client)
        } catch (err) {
          logger.warn({ err }, 'error removing client from lobby on disconnect')
        }
      },
    )
    user.subscribe(LobbyApi._getUserPath(lobby, user.userId), () => {
      return {
        type: 'status',
        lobby: Lobbies.toSummaryJson(this.lobbies.get(lobbyId)!),
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
    this.lobbies = this.lobbies.set(lobby.id, updated)
    this._publishLobbyDiff(lobby, updated)
    this._warmLobbyRegions(updated)
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
    this.lobbies = this.lobbies.set(lobby.id, updated)
    this._publishLobbyDiff(lobby, updated)
    this._warmLobbyRegions(updated)
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
    this.lobbies = this.lobbies.set(lobby.id, updatedLobby)
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

    this.lobbies = this.lobbies.set(lobby.id, updated)
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
    const afterKick = this.lobbies.get(lobby.id)!

    let updated
    try {
      updated = Lobbies.closeSlot(afterKick, teamIndex!, slotIndex!)
    } catch (err) {
      throw new errors.BadRequest((err as any).message)
    }
    this.lobbies = this.lobbies.set(lobby.id, updated)
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
      this.lobbies = this.lobbies.set(lobby.id, updated)
      this._publishLobbyDiff(lobby, updated)
      this._warmLobbyRegions(updated)
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

    this.lobbyBannedUsers = this.lobbyBannedUsers.update(lobby.id, Set(), val =>
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
    this.lobbies = this.lobbies.set(lobby.id, updated)
    this._publishLobbyDiff(lobby, updated, undefined, undefined, slotIndex)
    this._warmLobbyRegions(updated)
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
    this.lobbies = this.lobbies.set(lobby.id, updated)
    this._publishLobbyDiff(lobby, updated, undefined, undefined, slotIndex)
    this._warmLobbyRegions(updated)
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
      this.lobbies = this.lobbies.delete(lobby.id)
      this.lobbyBannedUsers = this.lobbyBannedUsers.delete(lobby.id)
      this.lobbyPlayerNetwork.deleteLobby(lobby.id)
      this._publishListChange('delete', lobby)
    } else {
      this.lobbies = this.lobbies.set(lobby.id, updatedLobby)
      this.lobbyPlayerNetwork.deleteUser(lobby.id, client.userId)
      this._publishLobbyDiff(
        lobby,
        updatedLobby,
        removalType === REMOVAL_TYPE_KICK ? client.userId : undefined,
        removalType === REMOVAL_TYPE_BAN ? client.userId : undefined,
      )
      this._warmLobbyRegions(updatedLobby)
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

    // Last chance to warm the lobby's regions before a session is created for it.
    this._warmLobbyRegions(lobby)

    const lobbyId = lobby.id
    const countdownTimer = createDeferred<void>()
    countdownTimer.catch(swallowNonBuiltins)
    setTimeout(() => countdownTimer.resolve(), 5000)
    this.lobbyCountdowns = this.lobbyCountdowns.set(
      lobbyId,
      new Countdown({ timer: countdownTimer }),
    )

    this._publishTo(lobby, { type: 'startCountdown' })
    this._publishListChange('delete', lobby)

    const gameConfig: GameConfig = {
      gameType: lobby.gameType,
      gameSubType: lobby.gameSubType,
      gameSource: GameSource.Lobby,
      gameSourceExtra: {
        host: lobby.host.userId,
        useLegacyLimits: lobby.useLegacyLimits,
      },
      lockedAlliances: false,
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
      this.lobbyCountdowns = this.lobbyCountdowns.delete(lobbyId)
      const abortController = new AbortController()
      this.loadingLobbies = this.loadingLobbies.set(lobbyId, abortController)

      // Each occupant's collected network info, to merge into their `GameLoadPlayer`.
      const networkByUser = this.lobbyPlayerNetwork.getAll(lobbyId)

      const gameLoadResult = await this.gameLoader.loadGame({
        players: getHumanSlots(lobby)
          .map(s => ({
            userId: s.userId!,
            isObserver: s.type === SlotType.Observer,
            region: s.region,
            rttMs: networkByUser.get(s.userId!)?.rttMs,
            netcodeV2Pubkey: networkByUser.get(s.userId!)?.netcodeV2Pubkey,
          }))
          .toArray(),
        playerInfos: getPlayerInfos(lobby),
        mapId: lobby.map!.id,
        gameConfig,
        signal: abortController.signal,
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
      if (this.lobbies.get(lobby.id) === lobby) {
        // This has been verified to be the same lobby, so sending cancel events is safe
        this._maybeCancelCountdown(lobby, false)
        this._maybeCancelLoading(lobby, false, usersAtFault)
      }
    }
  }

  _maybeCancelLoading(lobby: Lobby, isLobbyEmpty = false, usersAtFault?: SbUserId[]) {
    if (!this.loadingLobbies.has(lobby.id)) {
      // This lobby was closed before loading completed, likely because all the human users left or
      // disconnected.
      return
    }

    this.loadingLobbies.get(lobby.id)!.abort()
    this.loadingLobbies = this.loadingLobbies.delete(lobby.id)
    this._publishTo(lobby, {
      type: 'cancelLoading',
      usersAtFault,
    })
    if (!isLobbyEmpty) {
      this._publishListChange('add', lobby)
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
    this.lobbies = this.lobbies.delete(lobby.id)
    this.lobbyBannedUsers = this.lobbyBannedUsers.delete(lobby.id)
    this.loadingLobbies = this.loadingLobbies.delete(lobby.id)
    this.lobbyPlayerNetwork.deleteLobby(lobby.id)
  }

  // Cancels the countdown if one was occurring (no-op if it was not)
  _maybeCancelCountdown(lobby: Lobby, isLobbyEmpty = false) {
    if (!this.lobbyCountdowns.has(lobby.id)) {
      return
    }

    const countdown = this.lobbyCountdowns.get(lobby.id)
    countdown?.timer?.reject(new CountdownCanceledError('Countdown cancelled'))
    this.lobbyCountdowns = this.lobbyCountdowns.delete(lobby.id)
    this._publishTo(lobby, {
      type: 'cancelCountdown',
    })
    if (!isLobbyEmpty) {
      this._publishListChange('add', lobby)
    }
  }

  @Api(
    '/getLobbyState',
    validateBody({
      lobbyId: nonEmptyString,
    }),
  )
  async getLobbyState(data: Map<string, any>, next: NextFunc) {
    this.getClient(data)
    const { lobbyId } = data.get('body')

    let lobbyState
    if (!this.lobbies.has(lobbyId)) {
      lobbyState = 'nonexistent'
    } else {
      lobbyState = 'exists'
      if (this.lobbyCountdowns.has(lobbyId)) {
        lobbyState = 'countingDown'
      } else if (this.loadingLobbies.has(lobbyId)) {
        lobbyState = 'hasStarted'
      }
    }

    return { lobbyId, lobbyState }
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
    if (this.loadingLobbies.has(lobby.id)) {
      throw new errors.Conflict('lobby has already started')
    }
  }

  // Ensures that the lobby is not in a 'transient' state, that is, a state between being a lobby
  // and being an active game (counting down, loading, etc.). Transient states can be rolled back
  // (bringing the lobby back to a non-transient state)
  ensureLobbyNotTransient(lobby: Lobby) {
    if (this.lobbyCountdowns.has(lobby.id)) {
      throw new errors.Conflict('lobby is counting down')
    }
    if (this.loadingLobbies.has(lobby.id)) {
      throw new errors.Conflict('lobby has already started')
    }
  }

  _getLobbiesCount() {
    // TODO(tec27): Ideally this would remove full lobbies?
    return this.lobbies.count(
      l =>
        l.visibility === 'listed' &&
        !this.lobbyCountdowns.has(l.id) &&
        !this.loadingLobbies.has(l.id),
    )
  }

  _publishLobbiesCount() {
    this.nydus.publish('/lobbiesCount', { count: this._getLobbiesCount() })
  }

  /**
   * Publishes a change to the public lobby list, and refreshes the open-lobby count for everyone.
   *
   * A lobby's id is the capability that lets someone join it, so nothing about an unlisted lobby
   * (not even the bare id in a `delete`) may reach the public list channel. Every list publish must
   * go through here so that filtering can't be forgotten at a callsite.
   */
  _publishListChange(action: 'add' | 'delete' | 'update', lobby: Lobby) {
    if (lobby.visibility === 'listed') {
      this.nydus.publish(MOUNT_BASE, {
        action,
        payload: action === 'delete' ? lobby.id : Lobbies.toSummaryJson(lobby),
      })
    }
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

    this._publishListChange('update', newLobby)
  }

  static _getPath(lobby: Lobby) {
    return MOUNT_BASE + urlPath`/${lobby.id}`
  }

  static _getUserPath(lobby: Lobby, userId: SbUserId) {
    return MOUNT_BASE + urlPath`/${lobby.id}/${userId}`
  }

  static _getClientPath(lobby: Lobby, client: ClientSocketsGroup) {
    return MOUNT_BASE + urlPath`/${lobby.id}/${client.userId}/${client.clientId}`
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
