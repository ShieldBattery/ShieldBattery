import { singleton } from 'tsyringe'
import { ReadonlyDeep } from 'type-fest'
import createDeferred, { Deferred } from '../../../common/async/deferred'
import swallowNonBuiltins from '../../../common/async/swallow-non-builtins'
import { GameServerRegion, GameServerRegionId } from '../../../common/game-server-regions'
import { GameConfig, GameSource } from '../../../common/games/configuration'
import { GameType } from '../../../common/games/game-type'
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
  LobbyState,
  LobbyVisibility,
} from '../../../common/lobbies'
import { LobbySlotCreateEvent, LobbySummaryJson } from '../../../common/lobbies/lobby-network'
import { SbLobbyId } from '../../../common/lobbies/sb-lobby-id'
import * as Slots from '../../../common/lobbies/slot'
import { Slot, SlotType } from '../../../common/lobbies/slot'
import { SbMapId } from '../../../common/maps'
import { RaceChar } from '../../../common/races'
import { urlPath } from '../../../common/urls'
import { RestrictionKind } from '../../../common/users/restrictions'
import { makeSbUserId, SbUserId } from '../../../common/users/sb-user-id'
import { toBasicChannelInfo } from '../chat/chat-models'
import { CodedError } from '../errors/coded-error'
import { GameServerRegionsService } from '../game-server-regions/game-server-regions-service'
import { BaseGameLoaderError, GameLoader, GameLoadErrorType } from '../games/game-loader'
import { GameplayActivityRegistry } from '../games/gameplay-activity-registry'
import logger from '../logging/logger'
import { getMapInfos } from '../maps/map-models'
import { reparseMapsAsNeeded } from '../maps/map-operations'
import filterChatMessage from '../messaging/filter-chat-message'
import { processMessageContents } from '../messaging/process-chat-message'
import { NetcodeV2Service } from '../netcode-v2/netcode-v2-service'
import { RestrictionService } from '../users/restriction-service'
import { findUsersById } from '../users/user-model'
import {
  ClientSocketsGroup,
  UserSocketsGroup,
  UserSocketsManager,
} from '../websockets/socket-groups'
import { TypedPublisher } from '../websockets/typed-publisher'
import * as Lobbies from './lobby'
import { LobbyPlayerNetworkStore } from './lobby-player-network-store'
import { setLobbySummaryGetter } from './lobby-summaries'

/**
 * Machine-readable codes for every way a lobby operation can fail. Transports translate these into
 * whatever their callers understand (status codes, client-facing error codes), so the messages
 * carried alongside them are the only human-readable part.
 *
 * A few codes are specific to joining (`NoLobby`, `LobbyFull`, `Banned`, `JoinAlreadyStarted`,
 * `JoinAlreadyInActivity`): joining is the one operation whose failures the client renders
 * individually, so its outcomes are distinguished from the otherwise-identical failures of the
 * host-only operations.
 */
export enum LobbyServiceErrorCode {
  AlreadyInActivity = 'AlreadyInActivity',
  AlreadyInSlot = 'AlreadyInSlot',
  AlreadyStarted = 'AlreadyStarted',
  Banned = 'Banned',
  ChatRestricted = 'ChatRestricted',
  ComputerInObserverSlot = 'ComputerInObserverSlot',
  CountingDown = 'CountingDown',
  ForcedRace = 'ForcedRace',
  InvalidGameSubType = 'InvalidGameSubType',
  InvalidGameType = 'InvalidGameType',
  InvalidMap = 'InvalidMap',
  InvalidSlotId = 'InvalidSlotId',
  InvalidSlotOperation = 'InvalidSlotOperation',
  InvalidSlotType = 'InvalidSlotType',
  JoinAlreadyInActivity = 'JoinAlreadyInActivity',
  JoinAlreadyStarted = 'JoinAlreadyStarted',
  LobbyFull = 'LobbyFull',
  NameTaken = 'NameTaken',
  NoActiveClient = 'NoActiveClient',
  NoLobby = 'NoLobby',
  NotEnoughSides = 'NotEnoughSides',
  NotHost = 'NotHost',
  NotInLobby = 'NotInLobby',
  NotObserverSlot = 'NotObserverSlot',
  NotOwnSlot = 'NotOwnSlot',
  NotSlotController = 'NotSlotController',
  TargetNoActiveClient = 'TargetNoActiveClient',
  UserOffline = 'UserOffline',
}

export class LobbyServiceError extends CodedError<LobbyServiceErrorCode> {}

/**
 * The nydus path of the public lobby list channel, which is also the base path every lobby-specific
 * channel hangs off of.
 */
export const LOBBY_LIST_PATH = '/lobbies'

/** The channel every occupant of a lobby is subscribed to. */
export function getLobbyPath(lobbyId: SbLobbyId): string {
  return LOBBY_LIST_PATH + urlPath`/${lobbyId}`
}

/** The channel a single user in a lobby is subscribed to, across all of their clients. */
export function getLobbyUserPath(lobbyId: SbLobbyId, userId: SbUserId): string {
  return LOBBY_LIST_PATH + urlPath`/${lobbyId}/${userId}`
}

/** The channel a single client of a user in a lobby is subscribed to. */
export function getLobbyClientPath(lobbyId: SbLobbyId, userId: SbUserId, clientId: string): string {
  return LOBBY_LIST_PATH + urlPath`/${lobbyId}/${userId}/${clientId}`
}

/**
 * The events published on the lobby channels: changes to the public lobby list, the open-lobby
 * count, and the per-lobby/per-user/per-client channels.
 */
type LobbyPublishEvent =
  | { action: 'add' | 'delete' | 'update'; payload: SbLobbyId | LobbySummaryJson }
  | { count: number }
  | { type: string; [key: string]: any }

const REMOVAL_TYPE_NORMAL = 0
const REMOVAL_TYPE_KICK = 1
const REMOVAL_TYPE_BAN = 2

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

interface Countdown {
  timer?: Deferred<void>
}

function checkSubTypeValidity(gameType: GameType, gameSubType: number = 0, numSlots: number) {
  if (gameType === 'topVBottom') {
    if (gameSubType < 1 || gameSubType > numSlots - 1) {
      throw new LobbyServiceError(LobbyServiceErrorCode.InvalidGameSubType, 'Invalid game sub-type')
    }
  } else if (gameType === 'teamMelee' || gameType === 'teamFfa') {
    if (gameSubType < 2 || gameSubType > Math.min(4, numSlots)) {
      throw new LobbyServiceError(LobbyServiceErrorCode.InvalidGameSubType, 'Invalid game sub-type')
    }
  }
}

class CountdownCanceledError extends Error {}

@singleton()
export class LobbyService {
  readonly lobbies = new Map<SbLobbyId, Lobby>()
  readonly lobbyClients = new Map<ClientSocketsGroup, SbLobbyId>()
  readonly lobbyBannedUsers = new Map<SbLobbyId, Set<SbUserId>>()
  readonly lobbyCountdowns = new Map<SbLobbyId, Countdown>()
  readonly loadingLobbies = new Map<SbLobbyId, AbortController>()
  readonly lobbyPlayerNetwork = new LobbyPlayerNetworkStore()

  constructor(
    private publisher: TypedPublisher<LobbyPublishEvent>,
    private activityRegistry: GameplayActivityRegistry,
    private gameLoader: GameLoader,
    private restrictionService: RestrictionService,
    private gameServerRegionsService: GameServerRegionsService,
    private netcodeV2Service: NetcodeV2Service,
    private userSockets: UserSocketsManager,
  ) {
    // Registers this instance's registry as the source of truth for `lobby-summaries`'s seam, so
    // the unauthenticated HTTP summary endpoint and the lobby page-metadata resolver can read a
    // live lobby's summary without depending on this service directly.
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

  /** Returns a summary of every lobby that belongs on the public lobby list. */
  getListedSummaries(): LobbySummaryJson[] {
    return [...this.lobbies.values()]
      .filter(l => l.visibility === 'listed')
      .map(l => Lobbies.toSummaryJson(l))
  }

  async createLobby({
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
    user,
    client,
  }: {
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
    user: UserSocketsGroup
    client: ClientSocketsGroup
  }): Promise<{ id: SbLobbyId }> {
    const hostRegion = await this._resolveRegion(region)

    let mapInfo = (await getMapInfos([map]))[0]
    if (!mapInfo) {
      throw new LobbyServiceError(LobbyServiceErrorCode.InvalidMap, 'invalid map')
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
      [...this.lobbies.values()].some(l => l.visibility === 'listed' && l.name === name)
    ) {
      throw new LobbyServiceError(
        LobbyServiceErrorCode.NameTaken,
        'already another lobby with that name',
      )
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
      throw new LobbyServiceError(
        LobbyServiceErrorCode.AlreadyInActivity,
        'user is already active in a gameplay activity',
      )
    }

    this.lobbies.set(lobby.id, lobby)
    this.lobbyClients.set(client, lobby.id)
    if (rttMs !== undefined || clientPubkey !== undefined) {
      this.lobbyPlayerNetwork.set(lobby.id, client.userId, { rttMs, netcodeV2Pubkey: clientPubkey })
    }
    this._subscribeClientToLobby(lobby, user, client)

    this._publishListChange('add', lobby)
    this._warmLobbyRegions(lobby)

    return { id: lobby.id }
  }

  async joinLobby({
    id,
    region,
    rttMs,
    clientPubkey,
    user,
    client,
  }: {
    id: SbLobbyId
    region?: GameServerRegionId
    rttMs?: number
    clientPubkey?: string
    user: UserSocketsGroup
    client: ClientSocketsGroup
  }): Promise<void> {
    const joinRegion = await this._resolveRegion(region)

    if (!this.lobbies.has(id)) {
      throw new LobbyServiceError(LobbyServiceErrorCode.NoLobby, 'no lobby found with that id')
    }
    const lobby = this.lobbies.get(id)!
    try {
      this.ensureLobbyNotTransient(lobby)
    } catch (err) {
      throw new LobbyServiceError(
        LobbyServiceErrorCode.JoinAlreadyStarted,
        (err as Error).message,
        { cause: err },
      )
    }

    if (this.lobbyBannedUsers.get(lobby.id)?.has(client.userId)) {
      throw new LobbyServiceError(
        LobbyServiceErrorCode.Banned,
        'user has been banned from this lobby',
      )
    }

    const [teamIndex, slotIndex, availableSlot] = Lobbies.findAvailableSlot(lobby)
    if (teamIndex === undefined || slotIndex === undefined) {
      throw new LobbyServiceError(LobbyServiceErrorCode.LobbyFull, 'lobby is full')
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
    player = { ...player, region: joinRegion }

    let updated = Lobbies.addPlayer(lobby, teamIndex, slotIndex, player)

    if (!this.activityRegistry.registerActiveClient(user.userId, client)) {
      throw new LobbyServiceError(
        LobbyServiceErrorCode.JoinAlreadyInActivity,
        'user is already active in a gameplay activity',
      )
    }

    // TODO(tec27): Fix map signing URL refreshing in a more general way, see #593
    const mapInfo = (await getMapInfos([lobby.map!.id]))[0]
    updated = { ...updated, map: mapInfo }

    this.lobbies.set(id, updated)
    this.lobbyClients.set(client, id)
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
    const regions = [
      ...new Set(
        getHumanSlots(lobby)
          .map(slot => slot.region)
          .filter((region): region is GameServerRegionId => region !== undefined),
      ),
    ]
    if (regions.length > 0) {
      this.netcodeV2Service.warmRegions(regions)
    }
  }

  _subscribeClientToLobby(lobby: Lobby, user: UserSocketsGroup, client: ClientSocketsGroup) {
    const lobbyId = lobby.id
    client.subscribe(
      getLobbyPath(lobbyId),
      async () => {
        const lobby = this.lobbies.get(lobbyId)
        if (!lobby) {
          return undefined
        }

        try {
          const userInfos = await findUsersById(getHumanSlots(lobby).map(s => s.userId!))

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
    user.subscribe(getLobbyUserPath(lobbyId, user.userId), () => {
      return {
        type: 'status',
        lobby: Lobbies.toSummaryJson(this.lobbies.get(lobbyId)!),
      }
    })
    client.subscribe(getLobbyClientPath(lobbyId, client.userId, client.clientId))
  }

  async sendChat({ client, text }: { client: ClientSocketsGroup; text: string }): Promise<void> {
    const lobby = this.getLobbyForClient(client)
    const time = Date.now()

    const isChatRestricted = await this.restrictionService.isRestricted(
      client.userId,
      RestrictionKind.Chat,
    )
    if (isChatRestricted) {
      throw new LobbyServiceError(
        LobbyServiceErrorCode.ChatRestricted,
        'You are currently restricted from sending chat messages',
      )
    }

    const filtered = filterChatMessage(text)
    const [processedText, userMentions, channelMentions] = await processMessageContents(filtered)
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

  addComputer({ client, slotId }: { client: ClientSocketsGroup; slotId: string }): void {
    const lobby = this.getLobbyForClient(client)
    const [, , player] = findSlotByUserId(lobby, client.userId)
    this.ensureIsLobbyHost(lobby, player!)
    this.ensureLobbyNotTransient(lobby)

    if (isUms(lobby.gameType)) {
      throw new LobbyServiceError(
        LobbyServiceErrorCode.InvalidGameType,
        'invalid game type: ' + lobby.gameType,
      )
    }

    const [teamIndex, slotIndex, slotToAddComputer] = findSlotById(lobby, slotId)
    if (!slotToAddComputer) {
      throw new LobbyServiceError(LobbyServiceErrorCode.InvalidSlotId, 'invalid id')
    }
    if (slotToAddComputer.type !== 'open' && slotToAddComputer.type !== 'closed') {
      throw new LobbyServiceError(LobbyServiceErrorCode.InvalidSlotType, 'invalid slot type')
    }
    if (lobby.teams[teamIndex!].isObserver) {
      // A computer can't watch a game, and the game itself has no concept of one in an observer
      // slot — it would just be silently absent.
      throw new LobbyServiceError(
        LobbyServiceErrorCode.ComputerInObserverSlot,
        'cannot add computer to an observer slot',
      )
    }

    const computer = Slots.createComputer()
    const updated = Lobbies.addPlayer(lobby, teamIndex!, slotIndex!, computer)
    this.lobbies.set(lobby.id, updated)
    this._publishLobbyDiff(lobby, updated)
    this._warmLobbyRegions(updated)
  }

  changeSlot({ client, slotId }: { client: ClientSocketsGroup; slotId: string }): void {
    const lobby = this.getLobbyForClient(client)
    this.ensureLobbyNotTransient(lobby)
    const [sourceTeamIndex, sourceSlotIndex, sourceSlot] = findSlotByUserId(lobby, client.userId)

    const [destTeamIndex, destSlotIndex, destSlot] = findSlotById(lobby, slotId)
    if (!destSlot) {
      throw new LobbyServiceError(LobbyServiceErrorCode.InvalidSlotId, 'invalid id')
    }
    if (destSlot.type !== 'open' && destSlot.type !== 'controlledOpen') {
      throw new LobbyServiceError(
        LobbyServiceErrorCode.InvalidSlotType,
        'invalid destination slot type',
      )
    }
    if (sourceSlot === destSlot) {
      throw new LobbyServiceError(LobbyServiceErrorCode.AlreadyInSlot, 'already in that slot')
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
      throw new LobbyServiceError(
        LobbyServiceErrorCode.InvalidSlotOperation,
        (err as any).message,
        { cause: err },
      )
    }
    this.lobbies.set(lobby.id, updated)
    this._publishLobbyDiff(lobby, updated)
    this._warmLobbyRegions(updated)
  }

  setRace({
    client,
    slotId,
    race,
  }: {
    client: ClientSocketsGroup
    slotId: string
    race: RaceChar
  }): void {
    const lobby = this.getLobbyForClient(client)
    this.ensureLobbyNotLoading(lobby)
    const [, , player] = findSlotByUserId(lobby, client.userId)

    const [teamIndex, slotIndex, slotToSetRace] = findSlotById(lobby, slotId)
    if (!slotToSetRace) {
      throw new LobbyServiceError(LobbyServiceErrorCode.InvalidSlotId, 'invalid id')
    }
    if (
      slotToSetRace.type !== 'computer' &&
      slotToSetRace.type !== 'human' &&
      slotToSetRace.type !== 'controlledOpen' &&
      slotToSetRace.type !== 'controlledClosed'
    ) {
      throw new LobbyServiceError(LobbyServiceErrorCode.InvalidSlotType, 'invalid slot type')
    }

    if (slotToSetRace.type === 'computer') {
      this.ensureIsLobbyHost(lobby, player!)
    } else if (slotToSetRace.controlledBy) {
      if (slotToSetRace.controlledBy !== player!.id) {
        throw new LobbyServiceError(
          LobbyServiceErrorCode.NotSlotController,
          'must control a slot to set its race',
        )
      }
    } else if (slotToSetRace.id !== player!.id) {
      throw new LobbyServiceError(LobbyServiceErrorCode.NotOwnSlot, "cannot set other user's races")
    } else if (slotToSetRace.hasForcedRace) {
      throw new LobbyServiceError(
        LobbyServiceErrorCode.ForcedRace,
        'this slot has a forced race and cannot be changed',
      )
    }

    const updatedLobby = Lobbies.setRace(lobby, teamIndex!, slotIndex!, race)
    this.lobbies.set(lobby.id, updatedLobby)
    this._publishLobbyDiff(lobby, updatedLobby)
  }

  openSlot({ client, slotId }: { client: ClientSocketsGroup; slotId: string }): void {
    const lobby = this.getLobbyForClient(client)
    const [, , player] = findSlotByUserId(lobby, client.userId)
    this.ensureIsLobbyHost(lobby, player!)
    this.ensureLobbyNotTransient(lobby)

    const [teamIndex, slotIndex, slotToOpen] = findSlotById(lobby, slotId)
    if (!slotToOpen) {
      throw new LobbyServiceError(LobbyServiceErrorCode.InvalidSlotId, 'invalid slot id')
    }
    if (
      slotToOpen.type === 'open' ||
      slotToOpen.type === 'controlledOpen' ||
      slotToOpen.type === 'umsComputer'
    ) {
      throw new LobbyServiceError(LobbyServiceErrorCode.InvalidSlotType, 'invalid slot type')
    }

    let updated
    try {
      updated = Lobbies.openSlot(lobby, teamIndex!, slotIndex!)
    } catch (err) {
      throw new LobbyServiceError(
        LobbyServiceErrorCode.InvalidSlotOperation,
        (err as any).message,
        { cause: err },
      )
    }

    this.lobbies.set(lobby.id, updated)
    this._publishLobbyDiff(lobby, updated)
  }

  closeSlot({ client, slotId }: { client: ClientSocketsGroup; slotId: string }): void {
    const lobby = this.getLobbyForClient(client)
    const [, , player] = findSlotByUserId(lobby, client.userId)
    this.ensureIsLobbyHost(lobby, player!)
    this.ensureLobbyNotTransient(lobby)

    const [teamIndex, slotIndex, slotToClose] = findSlotById(lobby, slotId)
    if (!slotToClose) {
      throw new LobbyServiceError(LobbyServiceErrorCode.InvalidSlotId, 'invalid slot id')
    }

    if (
      slotToClose.type === 'closed' ||
      slotToClose.type === 'controlledClosed' ||
      slotToClose.type === 'umsComputer'
    ) {
      throw new LobbyServiceError(LobbyServiceErrorCode.InvalidSlotType, 'invalid slot type')
    }

    if (
      slotToClose.type === 'human' ||
      slotToClose.type === 'computer' ||
      slotToClose.type === 'observer'
    ) {
      this._kickPlayerFromLobby(lobby, teamIndex!, slotIndex!, slotToClose)
    }
    const afterKick = this.lobbies.get(lobby.id)!

    let updated
    try {
      updated = Lobbies.closeSlot(afterKick, teamIndex!, slotIndex!)
    } catch (err) {
      throw new LobbyServiceError(
        LobbyServiceErrorCode.InvalidSlotOperation,
        (err as any).message,
        { cause: err },
      )
    }
    this.lobbies.set(lobby.id, updated)
    this._publishLobbyDiff(afterKick, updated)
  }

  kickPlayer({ client, slotId }: { client: ClientSocketsGroup; slotId: string }): void {
    const lobby = this.getLobbyForClient(client)
    const [, , player] = findSlotByUserId(lobby, client.userId)
    this.ensureIsLobbyHost(lobby, player!)
    this.ensureLobbyNotTransient(lobby)

    const [teamIndex, slotIndex, playerToKick] = findSlotById(lobby, slotId)
    if (!playerToKick) {
      throw new LobbyServiceError(LobbyServiceErrorCode.InvalidSlotId, 'invalid slot id')
    }
    if (
      playerToKick.type !== 'human' &&
      playerToKick.type !== 'computer' &&
      playerToKick.type !== 'observer'
    ) {
      throw new LobbyServiceError(LobbyServiceErrorCode.InvalidSlotType, 'invalid slot type')
    }

    this._kickPlayerFromLobby(lobby, teamIndex!, slotIndex!, playerToKick)
  }

  _kickPlayerFromLobby(lobby: Lobby, teamIndex: number, slotIndex: number, playerToKick: Slot) {
    if (playerToKick.type === 'computer') {
      // NOTE(tec27): We know that removing a computer can never result in an empty lobby since a
      // human has to do it
      const updated = Lobbies.removePlayer(lobby, teamIndex, slotIndex, playerToKick)!
      this.lobbies.set(lobby.id, updated)
      this._publishLobbyDiff(lobby, updated)
      this._warmLobbyRegions(updated)
    } else if (playerToKick.type === 'human' || playerToKick.type === 'observer') {
      const client = this.activityRegistry.getClientForUser(playerToKick.userId!)
      if (!client) {
        throw new LobbyServiceError(
          LobbyServiceErrorCode.TargetNoActiveClient,
          'target player has no active client',
        )
      }
      this._removeClientFromLobby(lobby, client, REMOVAL_TYPE_KICK)
    }
  }

  banPlayer({ client, slotId }: { client: ClientSocketsGroup; slotId: string }): void {
    const lobby = this.getLobbyForClient(client)
    const [, , player] = findSlotByUserId(lobby, client.userId)
    this.ensureIsLobbyHost(lobby, player!)
    this.ensureLobbyNotTransient(lobby)

    const [, , playerToBan] = findSlotById(lobby, slotId)
    if (!playerToBan) {
      throw new LobbyServiceError(LobbyServiceErrorCode.InvalidSlotId, 'invalid slot id')
    }
    if (playerToBan.type !== 'human' && playerToBan.type !== 'observer') {
      throw new LobbyServiceError(LobbyServiceErrorCode.InvalidSlotType, 'invalid slot type')
    }

    let bannedUsers = this.lobbyBannedUsers.get(lobby.id)
    if (!bannedUsers) {
      bannedUsers = new Set()
      this.lobbyBannedUsers.set(lobby.id, bannedUsers)
    }
    bannedUsers.add(playerToBan.userId!)

    const clientToBan = this.activityRegistry.getClientForUser(playerToBan.userId!)
    if (!clientToBan) {
      throw new LobbyServiceError(
        LobbyServiceErrorCode.TargetNoActiveClient,
        'target player has no active client',
      )
    }
    this._removeClientFromLobby(lobby, clientToBan, REMOVAL_TYPE_BAN)
  }

  makeObserver({ client, slotId }: { client: ClientSocketsGroup; slotId: string }): void {
    const lobby = this.getLobbyForClient(client)
    const [, , player] = findSlotByUserId(lobby, client.userId)
    this.ensureIsLobbyHost(lobby, player!)
    this.ensureLobbyNotTransient(lobby)

    const [teamIndex, slotIndex, slot] = findSlotById(lobby, slotId)
    if (!slot) {
      throw new LobbyServiceError(LobbyServiceErrorCode.InvalidSlotId, 'invalid slot id')
    }

    let updated
    try {
      updated = Lobbies.makeObserver(lobby, teamIndex!, slotIndex!)
    } catch (err) {
      throw new LobbyServiceError(
        LobbyServiceErrorCode.InvalidSlotOperation,
        (err as any).message,
        { cause: err },
      )
    }
    this.lobbies.set(lobby.id, updated)
    this._publishLobbyDiff(lobby, updated)
    this._warmLobbyRegions(updated)
  }

  removeObserver({ client, slotId }: { client: ClientSocketsGroup; slotId: string }): void {
    const lobby = this.getLobbyForClient(client)
    const [, , player] = findSlotByUserId(lobby, client.userId)
    this.ensureIsLobbyHost(lobby, player!)
    this.ensureLobbyNotTransient(lobby)

    const [teamIndex, slotIndex, slot] = findSlotById(lobby, slotId)
    if (!slot) {
      throw new LobbyServiceError(LobbyServiceErrorCode.InvalidSlotId, 'invalid slot id')
    }
    if (!lobby.teams[teamIndex!]?.isObserver) {
      throw new LobbyServiceError(
        LobbyServiceErrorCode.NotObserverSlot,
        'Slot is not in the observer team',
      )
    }

    let updated
    try {
      updated = Lobbies.removeObserver(lobby, slotIndex!)
    } catch (err) {
      throw new LobbyServiceError(
        LobbyServiceErrorCode.InvalidSlotOperation,
        (err as any).message,
        { cause: err },
      )
    }
    this.lobbies.set(lobby.id, updated)
    this._publishLobbyDiff(lobby, updated)
    this._warmLobbyRegions(updated)
  }

  leaveLobby({ user }: { user: UserSocketsGroup }): void {
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
      this.lobbies.delete(lobby.id)
      this.lobbyBannedUsers.delete(lobby.id)
      this.lobbyPlayerNetwork.deleteLobby(lobby.id)
      this._publishListChange('delete', lobby)
    } else {
      this.lobbies.set(lobby.id, updatedLobby)
      this.lobbyPlayerNetwork.deleteUser(lobby.id, client.userId)
      this._publishLobbyDiff(
        lobby,
        updatedLobby,
        removalType === REMOVAL_TYPE_KICK ? client.userId : undefined,
        removalType === REMOVAL_TYPE_BAN ? client.userId : undefined,
      )
      this._warmLobbyRegions(updatedLobby)
    }
    this.lobbyClients.delete(client)
    this.activityRegistry.unregisterClientForUser(client.userId)

    this._publishToUser(lobby, client.userId, {
      type: 'status',
      lobby: null,
    })

    this._maybeCancelCountdown(lobby, isLobbyEmpty)
    this._maybeCancelLoading(lobby, isLobbyEmpty)

    try {
      const user = this.getUserById(client.userId)
      user.unsubscribe(getLobbyUserPath(lobby.id, client.userId))
    } catch {
      // Getting the user can fail if they've gone offline, but we don't need to unsubscribe
      // them in that case, so ignoring this error is fine
    }
    client.unsubscribe(getLobbyClientPath(lobby.id, client.userId, client.clientId))
    client.unsubscribe(getLobbyPath(lobby.id))
  }

  async startCountdown({ client }: { client: ClientSocketsGroup }): Promise<void> {
    const lobby = this.getLobbyForClient(client)
    if (!hasOpposingSides(lobby)) {
      throw new LobbyServiceError(
        LobbyServiceErrorCode.NotEnoughSides,
        'must have at least 2 opposing sides',
      )
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
    this.lobbyCountdowns.set(lobbyId, { timer: countdownTimer })

    this._publishTo(lobby, { type: 'startCountdown' })
    this._publishListChange('delete', lobby)

    const gameConfig: GameConfig = {
      gameType: lobby.gameType,
      gameSubType: lobby.gameSubType,
      gameSource: GameSource.Lobby,
      gameSourceExtra: {
        host: lobby.host.userId,
        useLegacyLimits: lobby.useLegacyLimits,
        visibility: lobby.visibility,
      },
      lockedAlliances: false,
      observers: getLobbySlots(lobby)
        .filter(s => s.type === SlotType.Observer)
        .map(s => s.userId!),
      teams: lobby.teams
        // The observer team never contains participants, and an empty husk entry for it would
        // read as a real (empty) team to matchup/results consumers.
        .filter(team => !team.isObserver)
        .map(team =>
          team.slots
            .filter(s => s.type === 'human' || s.type === 'computer' || s.type === 'umsComputer')
            .map(s => ({
              id: s.userId ?? makeSbUserId(0),
              race: s.race,
              isComputer: s.type === 'computer' || s.type === 'umsComputer',
            })),
        ),
    }

    let usersAtFault: SbUserId[] | undefined
    try {
      await countdownTimer
      this.lobbyCountdowns.delete(lobbyId)
      const abortController = new AbortController()
      this.loadingLobbies.set(lobbyId, abortController)

      // Each occupant's collected network info, to merge into their `GameLoadPlayer`.
      const networkByUser = this.lobbyPlayerNetwork.getAll(lobbyId)

      const gameLoadResult = await this.gameLoader.loadGame({
        players: getHumanSlots(lobby).map(s => ({
          userId: s.userId!,
          isObserver: s.type === SlotType.Observer,
          region: s.region,
          rttMs: networkByUser.get(s.userId!)?.rttMs,
          netcodeV2Pubkey: networkByUser.get(s.userId!)?.netcodeV2Pubkey,
        })),
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
    this.loadingLobbies.delete(lobby.id)
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
        user.unsubscribe(getLobbyUserPath(lobby.id, user.userId))
        client.unsubscribe(getLobbyPath(lobby.id))
        client.unsubscribe(getLobbyClientPath(lobby.id, client.userId, client.clientId))
        this.lobbyClients.delete(client)
        this.activityRegistry.unregisterClientForUser(user.userId)
      })
    this.lobbies.delete(lobby.id)
    this.lobbyBannedUsers.delete(lobby.id)
    this.loadingLobbies.delete(lobby.id)
    this.lobbyPlayerNetwork.deleteLobby(lobby.id)
  }

  // Cancels the countdown if one was occurring (no-op if it was not)
  _maybeCancelCountdown(lobby: Lobby, isLobbyEmpty = false) {
    if (!this.lobbyCountdowns.has(lobby.id)) {
      return
    }

    const countdown = this.lobbyCountdowns.get(lobby.id)
    countdown?.timer?.reject(new CountdownCanceledError('Countdown cancelled'))
    this.lobbyCountdowns.delete(lobby.id)
    this._publishTo(lobby, {
      type: 'cancelCountdown',
    })
    if (!isLobbyEmpty) {
      this._publishListChange('add', lobby)
    }
  }

  getLobbyState({ lobbyId }: { lobbyId: SbLobbyId }): {
    lobbyId: SbLobbyId
    lobbyState: LobbyState
  } {
    let lobbyState: LobbyState
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

  getUserById(id: SbUserId): UserSocketsGroup {
    const user = this.userSockets.getById(id)
    if (!user) throw new LobbyServiceError(LobbyServiceErrorCode.UserOffline, 'user not online')
    return user
  }

  getActiveClientForUser(userId: SbUserId): ClientSocketsGroup {
    const client = this.activityRegistry.getClientForUser(userId)
    if (!client) {
      throw new LobbyServiceError(LobbyServiceErrorCode.NoActiveClient, 'no active client for user')
    }
    return client
  }

  getLobbyForClient(client: ClientSocketsGroup): Lobby {
    if (!this.lobbyClients.has(client)) {
      throw new LobbyServiceError(LobbyServiceErrorCode.NotInLobby, 'must be in a lobby')
    }
    return this.lobbies.get(this.lobbyClients.get(client)!)!
  }

  ensureIsLobbyHost(lobby: Lobby, player: Slot) {
    if (player.id !== lobby.host.id) {
      throw new LobbyServiceError(LobbyServiceErrorCode.NotHost, 'must be a lobby host')
    }
  }

  ensureLobbyNotLoading(lobby: Lobby) {
    if (this.loadingLobbies.has(lobby.id)) {
      throw new LobbyServiceError(LobbyServiceErrorCode.AlreadyStarted, 'lobby has already started')
    }
  }

  // Ensures that the lobby is not in a 'transient' state, that is, a state between being a lobby
  // and being an active game (counting down, loading, etc.). Transient states can be rolled back
  // (bringing the lobby back to a non-transient state)
  ensureLobbyNotTransient(lobby: Lobby) {
    if (this.lobbyCountdowns.has(lobby.id)) {
      throw new LobbyServiceError(LobbyServiceErrorCode.CountingDown, 'lobby is counting down')
    }
    if (this.loadingLobbies.has(lobby.id)) {
      throw new LobbyServiceError(LobbyServiceErrorCode.AlreadyStarted, 'lobby has already started')
    }
  }

  getLobbiesCount() {
    // TODO(tec27): Ideally this would remove full lobbies?
    let count = 0
    for (const lobby of this.lobbies.values()) {
      if (
        lobby.visibility === 'listed' &&
        !this.lobbyCountdowns.has(lobby.id) &&
        !this.loadingLobbies.has(lobby.id)
      ) {
        count += 1
      }
    }
    return count
  }

  _publishLobbiesCount() {
    this.publisher.publish('/lobbiesCount', { count: this.getLobbiesCount() })
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
      this.publisher.publish(LOBBY_LIST_PATH, {
        action,
        payload: action === 'delete' ? lobby.id : Lobbies.toSummaryJson(lobby),
      })
    }
    this._publishLobbiesCount()
  }

  _publishTo(lobby: Lobby, data?: any) {
    this.publisher.publish(getLobbyPath(lobby.id), data)
  }

  _publishToUser(lobby: Lobby, userId: SbUserId, data?: any) {
    this.publisher.publish(getLobbyUserPath(lobby.id, userId), data)
  }

  _publishLobbyDiff(
    oldLobby: Lobby,
    newLobby: Lobby,
    kickedUser?: SbUserId,
    bannedUser?: SbUserId,
  ) {
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
    const same = new Set([...oldSlots].filter(id => newSlots.has(id)))
    const left = [...oldHumans].filter(id => !same.has(id))
    const created = [...newSlots].filter(id => !same.has(id))

    const oldIdSlots = new Map<string, [teamIndex: number, slotIndex: number, slot: Slot]>(
      getLobbySlotsWithIndexes(oldLobby).map(([teamIndex, slotIndex, slot]) => [
        slot.id,
        [teamIndex, slotIndex, slot],
      ]),
    )
    const newIdSlots = new Map<string, [teamIndex: number, slotIndex: number, slot: Slot]>(
      getLobbySlotsWithIndexes(newLobby).map(([teamIndex, slotIndex, slot]) => [
        slot.id,
        [teamIndex, slotIndex, slot],
      ]),
    )

    for (const id of left) {
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

    for (const id of created) {
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

    for (const id of same) {
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
}
