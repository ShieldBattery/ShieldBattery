import { singleton } from 'tsyringe'
import { ReadonlyDeep } from 'type-fest'
import createDeferred, { Deferred } from '../../../common/async/deferred'
import swallowNonBuiltins from '../../../common/async/swallow-non-builtins'
import { GameServerRegion, GameServerRegionId } from '../../../common/game-server-regions'
import { GameConfig, GameSource } from '../../../common/games/configuration'
import { GameType, isTeamType } from '../../../common/games/game-type'
import {
  BenchedUser,
  findBenchedUser,
  findSlotById,
  findSlotByUserId,
  getHumanSlots,
  getLobbySlots,
  getLobbySlotsWithIndexes,
  getObserverTeam,
  getPlayerInfos,
  hasObservers,
  hasOpposingSides,
  isLobbyEmpty,
  isSlotUnoccupied,
  isUms,
  Lobby,
  LobbyState,
  LobbyVisibility,
  MAX_BENCH,
} from '../../../common/lobbies'
import {
  LobbyBenchRemoveEvent,
  LobbyChangedSetting,
  LobbyLifecycle,
  LobbyPreviewJson,
  LobbyRunStateJson,
  LobbySlotCreateEvent,
  LobbySummaryJson,
} from '../../../common/lobbies/lobby-network'
import { SbLobbyId } from '../../../common/lobbies/sb-lobby-id'
import * as Slots from '../../../common/lobbies/slot'
import { Slot, SlotType } from '../../../common/lobbies/slot'
import { MapInfo, SbMapId } from '../../../common/maps'
import { RaceChar } from '../../../common/races'
import { urlPath } from '../../../common/urls'
import { RestrictionKind } from '../../../common/users/restrictions'
import { makeSbUserId, SbUserId } from '../../../common/users/sb-user-id'
import { toBasicChannelInfo } from '../chat/chat-models'
import { CodedError } from '../errors/coded-error'
import { GameServerRegionsService } from '../game-server-regions/game-server-regions-service'
import { GameLifecycleEvents } from '../games/game-lifecycle-events'
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
 * A few codes are specific to joining (`NoLobby`, `LobbyFull`, `ObserversFull`, `Banned`,
 * `JoinAlreadyStarted`, `JoinAlreadyInActivity`): joining is the one operation whose failures the
 * client renders individually, so its outcomes are distinguished from the otherwise-identical
 * failures of the host-only operations.
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
  GameInProgress = 'GameInProgress',
  InvalidGameSubType = 'InvalidGameSubType',
  InvalidGameType = 'InvalidGameType',
  InvalidMap = 'InvalidMap',
  InvalidSlotId = 'InvalidSlotId',
  InvalidSlotOperation = 'InvalidSlotOperation',
  InvalidSlotType = 'InvalidSlotType',
  JoinAlreadyInActivity = 'JoinAlreadyInActivity',
  JoinAlreadyStarted = 'JoinAlreadyStarted',
  LobbyFull = 'LobbyFull',
  NoActiveClient = 'NoActiveClient',
  NoLobby = 'NoLobby',
  NotEnoughSides = 'NotEnoughSides',
  NotHost = 'NotHost',
  NotInLobby = 'NotInLobby',
  NotObserverSlot = 'NotObserverSlot',
  NotOwnSlot = 'NotOwnSlot',
  NotSlotController = 'NotSlotController',
  ObserversFull = 'ObserversFull',
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

/**
 * The channel carrying a single lobby's seat-by-seat layout, for browsers previewing it. The
 * segment after the lobby id is a user id on the sibling channels, and user ids are numeric, so the
 * literal `preview` can never name one of those.
 */
export function getLobbyPreviewPath(lobbyId: SbLobbyId): string {
  return LOBBY_LIST_PATH + urlPath`/${lobbyId}/preview`
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
 * The events published on the lobby channels: changes to the public lobby list, a single lobby's
 * preview, the open-lobby count, and the per-lobby/per-user/per-client channels.
 */
type LobbyPublishEvent =
  | { action: 'add' | 'delete' | 'update'; payload: SbLobbyId | LobbySummaryJson }
  | { action: 'preview'; payload: LobbyPreviewJson }
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

/**
 * The game a lobby currently has running, and which of the lobby's members are still in it.
 *
 * Members drop out of `inGameUsers` one at a time as their games end; when the last one does, the
 * lobby regroups and this is discarded. Bench members were never in the game, so they never appear
 * here.
 */
interface LobbyRunState {
  gameId: string
  inGameUsers: Set<SbUserId>
}

/** Returns the user ids of everyone in a lobby, seated or waiting on the bench. */
function getLobbyMemberIds(lobby: Lobby): SbUserId[] {
  return [...getHumanSlots(lobby).map(slot => slot.userId!), ...lobby.bench.map(b => b.userId)]
}

/**
 * Returns whether a map defines any slot a person could occupy when its own settings are used. A
 * map without one describes a lobby nobody can be in, so it can't be played that way.
 */
function hasUmsPlayerSlots(map: MapInfo): boolean {
  return map.mapData.umsForces.some(force => force.players.some(player => !player.computer))
}

/**
 * Finds the member a host operation names when no slot has that id: someone waiting on the bench
 * holds no slot, so they are named by their user id instead.
 */
function findBenchedTarget(lobby: Lobby, id: string): BenchedUser | undefined {
  return lobby.bench.find(benched => String(benched.userId) === id)
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
  readonly runStates = new Map<SbLobbyId, LobbyRunState>()
  readonly lobbyPlayerNetwork = new LobbyPlayerNetworkStore()

  constructor(
    private publisher: TypedPublisher<LobbyPublishEvent>,
    private activityRegistry: GameplayActivityRegistry,
    private gameLoader: GameLoader,
    private restrictionService: RestrictionService,
    private gameServerRegionsService: GameServerRegionsService,
    private netcodeV2Service: NetcodeV2Service,
    private userSockets: UserSocketsManager,
    private gameLifecycleEvents: GameLifecycleEvents,
  ) {
    // Registers this instance's registry as the source of truth for `lobby-summaries`'s seam, so
    // the unauthenticated HTTP summary endpoint and the lobby page-metadata resolver can read a
    // live lobby's summary without depending on this service directly.
    setLobbySummaryGetter(id => {
      const lobby = this.lobbies.get(id)
      if (!lobby) {
        return undefined
      }
      const lifecycle = this._lifecycleOf(id)
      // A counting-down or loading lobby can't be joined, so it's reported as gone rather than as
      // an open lobby with slots available. A lobby with a game running still takes joins (onto its
      // bench), so it reports itself like any other.
      if (lifecycle === 'countingDown' || lifecycle === 'loading') {
        return undefined
      }
      return Lobbies.toSummaryJson(lobby, lifecycle)
    })

    this.gameLifecycleEvents.on('userGameEnded', ({ gameId, userId }) => {
      try {
        this._onUserGameEnded(gameId, userId)
      } catch (err) {
        logger.error({ err }, 'error handling the end of a game for a lobby member')
      }
    })
  }

  /**
   * Returns where a lobby is in its life, which is what everything that produces a summary or an
   * init payload reports.
   *
   * A lobby that is doing none of these things is `gathering`, which is also what an id that names
   * no lobby at all reports — existence is a separate question, answered by `lobbies`.
   */
  private _lifecycleOf(lobbyId: SbLobbyId): LobbyLifecycle {
    if (this.lobbyCountdowns.has(lobbyId)) {
      return 'countingDown'
    }
    if (this.loadingLobbies.has(lobbyId)) {
      return 'loading'
    }
    if (this.runStates.has(lobbyId)) {
      return 'inGame'
    }
    return 'gathering'
  }

  /** Serializes a lobby to its list/status summary, with its current lifecycle attached. */
  private _toSummaryJson(lobby: Lobby): LobbySummaryJson {
    return Lobbies.toSummaryJson(lobby, this._lifecycleOf(lobby.id))
  }

  /** Serializes a lobby's running game for the wire, or `undefined` if it has none. */
  private _runStateJson(lobbyId: SbLobbyId): LobbyRunStateJson | undefined {
    const runState = this.runStates.get(lobbyId)
    return runState
      ? { gameId: runState.gameId, inGameUsers: [...runState.inGameUsers] }
      : undefined
  }

  /** Returns a summary of every lobby that belongs on the public lobby list. */
  getListedSummaries(): LobbySummaryJson[] {
    return [...this.lobbies.values()]
      .filter(l => l.visibility === 'listed')
      .map(l => [l, this._lifecycleOf(l.id)] as const)
      .filter(([, lifecycle]) => lifecycle !== 'countingDown' && lifecycle !== 'loading')
      .map(([lobby, lifecycle]) => Lobbies.toSummaryJson(lobby, lifecycle))
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
    leaveCurrentLobby,
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
    /**
     * When set, a client currently in a different lobby is removed from it as part of this create
     * rather than the create failing outright. Applied only after every failure check has passed,
     * so a failed create never strands the client lobby-less.
     */
    leaveCurrentLobby?: boolean
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

    if (leaveCurrentLobby) {
      this._leaveCurrentLobby(client)
    }

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
    asObserver,
    leaveCurrentLobby,
    user,
    client,
  }: {
    id: SbLobbyId
    region?: GameServerRegionId
    rttMs?: number
    clientPubkey?: string
    /** Whether the joiner wants an observer seat specifically; see the handling below. */
    asObserver?: boolean
    /**
     * When set, a client currently in a different lobby is removed from it as part of this join
     * rather than the join failing outright. Applied only after every failure check on the target
     * lobby has passed, so a failed join never strands the client lobby-less.
     */
    leaveCurrentLobby?: boolean
    user: UserSocketsGroup
    client: ClientSocketsGroup
  }): Promise<void> {
    const joinRegion = await this._resolveRegion(region)

    if (!this.lobbies.has(id)) {
      throw new LobbyServiceError(LobbyServiceErrorCode.NoLobby, 'no lobby found with that id')
    }
    if (this.lobbyClients.get(client) === id) {
      // Already seated in the target lobby: joining it again is what a member clicking join on
      // their own lobby (e.g. during a countdown) looks like, so it resolves as a no-op success
      // rather than reaching the checks below.
      return
    }

    // TODO(tec27): Fix map signing URL refreshing in a more general way, see #593
    // Fetched before the lobby snapshot below: everything from the snapshot to the write-back has
    // to stay synchronous, or a concurrent operation on the lobby (e.g. a settings change
    // replacing the whole layout) would be silently reverted by it.
    const refreshedMap = (await getMapInfos([this.lobbies.get(id)!.map!.id]))[0]

    const lobby = this.lobbies.get(id)
    if (!lobby) {
      throw new LobbyServiceError(LobbyServiceErrorCode.NoLobby, 'no lobby found with that id')
    }

    const lifecycle = this._lifecycleOf(id)
    // A lobby on its way into a game is briefly closed to joins: its roster is being handed to the
    // game loader, so there is nothing a joiner could be added to yet. A lobby with a game already
    // running still takes joins, onto its bench.
    if (lifecycle === 'countingDown') {
      throw new LobbyServiceError(
        LobbyServiceErrorCode.JoinAlreadyStarted,
        'lobby is counting down',
      )
    }
    if (lifecycle === 'loading') {
      throw new LobbyServiceError(
        LobbyServiceErrorCode.JoinAlreadyStarted,
        'lobby has already started',
      )
    }

    if (this.lobbyBannedUsers.get(lobby.id)?.has(client.userId)) {
      throw new LobbyServiceError(
        LobbyServiceErrorCode.Banned,
        'user has been banned from this lobby',
      )
    }

    let updated: Lobby
    if (lifecycle === 'inGame') {
      // The lobby's seats, including its observer slots, are the running game's roster; an
      // observer request is no more seatable than a player request while that's true, so it
      // gets the same bench treatment as any other join here.
      updated = this._benchJoiner(lobby, client.userId, joinRegion)
    } else if (asObserver) {
      // An explicit observer request takes an open observer slot or fails outright: unlike an
      // ordinary join, it must never fall back to a player slot or the bench, since neither is
      // what was asked for.
      const [obsTeamIndex, obsTeam] = getObserverTeam(lobby)
      const obsSlotIndex = obsTeam?.slots.findIndex(s => s.type === SlotType.Open) ?? -1
      if (obsTeamIndex === undefined || obsSlotIndex === -1) {
        throw new LobbyServiceError(
          LobbyServiceErrorCode.ObserversFull,
          'no observer slots are open',
        )
      }
      const player: Slot = { ...Slots.createObserver(client.userId), region: joinRegion }
      updated = Lobbies.addPlayer(lobby, obsTeamIndex, obsSlotIndex, player)
    } else {
      const [teamIndex, slotIndex, availableSlot] = Lobbies.findAvailableSlot(lobby)
      if (teamIndex === undefined || slotIndex === undefined) {
        updated = this._benchJoiner(lobby, client.userId, joinRegion)
      } else {
        let player: Slot
        const [, observerTeam] = getObserverTeam(lobby)
        if (observerTeam && observerTeam.slots.find(s => s.id === availableSlot.id)) {
          // Every player slot was taken, and the search above fell through to the observer team.
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

        updated = Lobbies.addPlayer(lobby, teamIndex, slotIndex, player)
      }
    }

    if (leaveCurrentLobby) {
      this._leaveCurrentLobby(client)
    }

    if (!this.activityRegistry.registerActiveClient(user.userId, client)) {
      throw new LobbyServiceError(
        LobbyServiceErrorCode.JoinAlreadyInActivity,
        'user is already active in a gameplay activity',
      )
    }

    if (refreshedMap && updated.map!.id === refreshedMap.id) {
      // A settings change during the fetch above can have swapped the map, in which case its own
      // freshly-fetched info stays and the stale refresh is discarded
      updated = { ...updated, map: refreshedMap }
    }

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
   * Adds a joiner to the bench, keeping the region they reported. Nobody is turned away from a
   * lobby that is merely full: they wait here until a seat frees up or the host makes room for
   * them. Rejects with `LobbyFull` once the bench itself is at capacity.
   */
  private _benchJoiner(
    lobby: Lobby,
    userId: SbUserId,
    region: GameServerRegionId | undefined,
  ): Lobby {
    if (lobby.bench.length >= MAX_BENCH) {
      throw new LobbyServiceError(LobbyServiceErrorCode.LobbyFull, 'lobby is full')
    }
    return Lobbies.addToBench(lobby, {
      userId,
      race: 'r',
      joinedAt: Date.now(),
      region,
    })
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
          const userInfos = await findUsersById(getLobbyMemberIds(lobby))

          return {
            type: 'init',
            lobby,
            runState: this._runStateJson(lobbyId),
            userInfos,
          }
        } catch (err) {
          logger.error({ err }, 'error getting user infos for lobby init')
          return {
            type: 'init',
            lobby,
            runState: this._runStateJson(lobbyId),
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
        lobby: Lobbies.toSummaryJson(this.lobbies.get(lobbyId)!, this._lifecycleOf(lobbyId)),
      }
    })
    client.subscribe(getLobbyClientPath(lobbyId, client.userId, client.clientId))
  }

  async sendChat({
    client,
    lobbyId,
    text,
  }: {
    client: ClientSocketsGroup
    lobbyId?: SbLobbyId
    text: string
  }): Promise<void> {
    const lobby = this.getLobbyForClient(client, lobbyId)
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

  /**
   * Changes the settings of a lobby that is still gathering, reconciling everyone in it into the
   * layout the new settings describe.
   *
   * Settings that aren't named are left as they are. Since reconciliation can rearrange the whole
   * lobby, the occupants receive the result as a complete lobby rather than as a set of changes,
   * alongside the list of settings the host actually changed.
   */
  async updateSettings({
    client,
    lobbyId,
    map,
    gameType,
    gameSubType,
    allowObservers,
    useLegacyLimits,
  }: {
    client: ClientSocketsGroup
    lobbyId?: SbLobbyId
    map?: SbMapId
    gameType?: GameType
    gameSubType?: number
    allowObservers?: boolean
    useLegacyLimits?: boolean
  }): Promise<void> {
    const lobby = this.getLobbyForClient(client, lobbyId)
    const [, , player] = findSlotByUserId(lobby, client.userId)
    this.ensureIsLobbyHost(lobby, player)
    this.ensureLobbyNotTransient(lobby)

    let fetchedMap: MapInfo | undefined
    if (map !== undefined) {
      const found = (await getMapInfos([map]))[0]
      if (!found) {
        throw new LobbyServiceError(LobbyServiceErrorCode.InvalidMap, 'invalid map')
      }
      ;[fetchedMap] = await reparseMapsAsNeeded([found])
    }

    // Fetching the map info gives other operations on this lobby a chance to run, so everything
    // below works from the lobby as it is now.
    const current = this.getLobbyForClient(client, lobbyId)
    const [, , currentPlayer] = findSlotByUserId(current, client.userId)
    this.ensureIsLobbyHost(current, currentPlayer)
    this.ensureLobbyNotTransient(current)

    const mapInfo = fetchedMap ?? current.map!
    const nextGameType = gameType ?? current.gameType
    // Only team game types are configured by a sub-type, so carrying one over from a type that had
    // one would leave the lobby describing a configuration it doesn't have.
    const nextGameSubType = isTeamType(nextGameType) ? (gameSubType ?? current.gameSubType) : 0
    const nextAllowObservers = allowObservers ?? hasObservers(current)
    const nextUseLegacyLimits = useLegacyLimits ?? current.useLegacyLimits

    if (isUms(nextGameType) && !hasUmsPlayerSlots(mapInfo)) {
      throw new LobbyServiceError(
        LobbyServiceErrorCode.InvalidGameType,
        'map defines no player slots to use its settings from',
      )
    }

    let numSlots
    switch (nextGameType) {
      case 'oneVOne':
        numSlots = 2
        break
      case 'teamMelee':
      case 'teamFfa':
        numSlots = 8
        break
      default:
        numSlots = mapInfo.mapData.slots
    }
    // Validated against the map's own slot count (not the derived team-type slot total), the same
    // way creating a lobby validates it
    checkSubTypeValidity(nextGameType, nextGameSubType, mapInfo.mapData.slots)

    const changedSettings: LobbyChangedSetting[] = []
    if (mapInfo.id !== current.map!.id) changedSettings.push('map')
    if (nextGameType !== current.gameType) changedSettings.push('gameType')
    if (nextGameSubType !== current.gameSubType) changedSettings.push('gameSubType')
    if (nextAllowObservers !== hasObservers(current)) changedSettings.push('allowObservers')
    if (nextUseLegacyLimits !== current.useLegacyLimits) changedSettings.push('useLegacyLimits')
    if (!changedSettings.length) {
      // Every requested value matches what the lobby already has, so there is nothing to apply or
      // to announce
      return
    }

    let updated
    try {
      updated = Lobbies.applySettingsChange(current, {
        map: mapInfo,
        gameType: nextGameType,
        gameSubType: nextGameSubType,
        numSlots,
        allowObservers: nextAllowObservers,
        useLegacyLimits: nextUseLegacyLimits,
      })
    } catch (err) {
      throw new LobbyServiceError(
        LobbyServiceErrorCode.InvalidSlotOperation,
        (err as any).message,
        { cause: err },
      )
    }
    updated = this._seatBenchOverflow(updated)

    this.lobbies.set(updated.id, updated)
    this._publishTo(updated, {
      type: 'settingsChange',
      changedSettings,
      lobby: updated,
    })
    this._publishListChange('update', updated)
    this._warmLobbyRegions(updated)
  }

  /**
   * Moves the occupant of one slot into another at the host's direction. An unoccupied destination
   * is a plain move; an occupied one exchanges the two occupants, which is the only way to
   * rearrange a lobby that has no room left. A closed destination is host-reserved, not
   * unavailable, so the host can move someone straight onto one and it opens as a side effect of
   * the move. Self-serve seat changes (`changeSlot`) never do this — closed slots stay off-limits
   * to a member picking their own seat.
   */
  moveSlot({
    client,
    lobbyId,
    fromSlotId,
    toSlotId,
  }: {
    client: ClientSocketsGroup
    lobbyId?: SbLobbyId
    fromSlotId: string
    toSlotId: string
  }): void {
    const lobby = this.getLobbyForClient(client, lobbyId)
    const [, , player] = findSlotByUserId(lobby, client.userId)
    this.ensureIsLobbyHost(lobby, player)
    this.ensureLobbyNotTransient(lobby)

    const [sourceTeamIndex, sourceSlotIndex, sourceSlot] = findSlotById(lobby, fromSlotId)
    const [destTeamIndex, destSlotIndex, destSlot] = findSlotById(lobby, toSlotId)
    if (!sourceSlot || !destSlot) {
      throw new LobbyServiceError(LobbyServiceErrorCode.InvalidSlotId, 'invalid slot id')
    }
    if (
      sourceSlot.type !== SlotType.Human &&
      sourceSlot.type !== SlotType.Observer &&
      sourceSlot.type !== SlotType.Computer
    ) {
      throw new LobbyServiceError(LobbyServiceErrorCode.InvalidSlotType, 'invalid source slot type')
    }
    if (sourceSlot === destSlot) {
      throw new LobbyServiceError(LobbyServiceErrorCode.AlreadyInSlot, 'already in that slot')
    }
    const isMove = isSlotUnoccupied(destSlot)
    if (
      Lobbies.hasControlledOpens(lobby.gameType) &&
      sourceSlot.type !== SlotType.Human &&
      (destSlot.type === SlotType.ControlledOpen ||
        destSlot.type === SlotType.ControlledClosed ||
        !isSlotUnoccupied(destSlot))
    ) {
      // A controlled team is built around the humans in it, so only they can enter one: a computer
      // team is moved or removed as a whole (a lone computer taken out of one would blank the rest
      // of its team), same as everywhere else computers are placed in these game types. Moving into
      // an *empty* team stays allowed — its plain open slots build a new team around the arrival.
      throw new LobbyServiceError(
        LobbyServiceErrorCode.InvalidSlotType,
        'only players can be moved in this game type',
      )
    }
    if (lobby.teams[destTeamIndex!].isObserver && sourceSlot.type === SlotType.Computer) {
      throw new LobbyServiceError(
        LobbyServiceErrorCode.ComputerInObserverSlot,
        'cannot move a computer to an observer slot',
      )
    }

    // A closed destination is host-reserved rather than off-limits: open it as part of the move
    // instead of making the host open it first in a separate step.
    const lobbyToMove =
      isMove && (destSlot.type === SlotType.Closed || destSlot.type === SlotType.ControlledClosed)
        ? Lobbies.openSlot(lobby, destTeamIndex!, destSlotIndex!)
        : lobby

    let updated
    try {
      updated = isMove
        ? Lobbies.movePlayerToSlot(
            lobbyToMove,
            sourceTeamIndex!,
            sourceSlotIndex!,
            destTeamIndex!,
            destSlotIndex!,
          )
        : Lobbies.swapSlots(
            lobbyToMove,
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
    // A move (e.g. into an observer slot) leaves the source slot open, so someone waiting on the
    // bench may have a seat
    updated = this._seatBenchOverflow(updated)

    this.lobbies.set(lobby.id, updated)
    this._publishLobbyDiff(lobby, updated)
    this._warmLobbyRegions(updated)
  }

  addComputer({
    client,
    lobbyId,
    slotId,
  }: {
    client: ClientSocketsGroup
    lobbyId?: SbLobbyId
    slotId: string
  }): void {
    const lobby = this.getLobbyForClient(client, lobbyId)
    const [, , player] = findSlotByUserId(lobby, client.userId)
    this.ensureIsLobbyHost(lobby, player)
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

  changeSlot({
    client,
    lobbyId,
    slotId,
  }: {
    client: ClientSocketsGroup
    lobbyId?: SbLobbyId
    slotId: string
  }): void {
    const lobby = this.getLobbyForClient(client, lobbyId)
    this.ensureLobbyNotTransient(lobby)
    const [sourceTeamIndex, sourceSlotIndex, sourceSlot] = findSlotByUserId(lobby, client.userId)
    if (!sourceSlot && !findBenchedUser(lobby, client.userId)) {
      throw new LobbyServiceError(LobbyServiceErrorCode.NotInLobby, 'must be in a lobby')
    }

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
      updated = sourceSlot
        ? Lobbies.movePlayerToSlot(
            lobby,
            sourceTeamIndex!,
            sourceSlotIndex!,
            destTeamIndex!,
            destSlotIndex!,
          )
        : // Someone waiting on the bench takes the seat they picked, keeping what they were
          // waiting with.
          Lobbies.seatBenchedUser(lobby, client.userId, destTeamIndex!, destSlotIndex!)
    } catch (err) {
      throw new LobbyServiceError(
        LobbyServiceErrorCode.InvalidSlotOperation,
        (err as any).message,
        { cause: err },
      )
    }
    // A seated player switching seats leaves their old slot open, so someone waiting on the bench
    // may have a seat
    updated = this._seatBenchOverflow(updated)
    this.lobbies.set(lobby.id, updated)
    this._publishLobbyDiff(lobby, updated)
    this._warmLobbyRegions(updated)
  }

  setRace({
    client,
    lobbyId,
    slotId,
    race,
  }: {
    client: ClientSocketsGroup
    lobbyId?: SbLobbyId
    slotId: string
    race: RaceChar
  }): void {
    const lobby = this.getLobbyForClient(client, lobbyId)
    this.ensureLobbyNotLoading(lobby)
    const [, , player] = findSlotByUserId(lobby, client.userId)
    if (!player) {
      // A member waiting on the bench has no slot of their own, and every slot they could name
      // belongs to someone else.
      throw new LobbyServiceError(LobbyServiceErrorCode.NotOwnSlot, "cannot set other user's races")
    }

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
      this.ensureIsLobbyHost(lobby, player)
    } else if (slotToSetRace.controlledBy) {
      if (slotToSetRace.controlledBy !== player.id) {
        throw new LobbyServiceError(
          LobbyServiceErrorCode.NotSlotController,
          'must control a slot to set its race',
        )
      }
    } else if (slotToSetRace.id !== player.id) {
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

  openSlot({
    client,
    lobbyId,
    slotId,
  }: {
    client: ClientSocketsGroup
    lobbyId?: SbLobbyId
    slotId: string
  }): void {
    const lobby = this.getLobbyForClient(client, lobbyId)
    const [, , player] = findSlotByUserId(lobby, client.userId)
    this.ensureIsLobbyHost(lobby, player)
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
    updated = this._seatBenchOverflow(updated)

    this.lobbies.set(lobby.id, updated)
    this._publishLobbyDiff(lobby, updated)
    this._warmLobbyRegions(updated)
  }

  closeSlot({
    client,
    lobbyId,
    slotId,
  }: {
    client: ClientSocketsGroup
    lobbyId?: SbLobbyId
    slotId: string
  }): void {
    const lobby = this.getLobbyForClient(client, lobbyId)
    const [, , player] = findSlotByUserId(lobby, client.userId)
    this.ensureIsLobbyHost(lobby, player)
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
      (slotToClose.type === 'human' || slotToClose.type === 'observer') &&
      getHumanSlots(lobby).length === 1
    ) {
      // Removing the last seated member would leave the lobby to be closed (or, with members
      // waiting on the bench, alive but unable to ever seat them, since this slot gets closed
      // rather than handed over). The host can leave instead if they don't want the lobby.
      throw new LobbyServiceError(
        LobbyServiceErrorCode.InvalidSlotOperation,
        "cannot close the last seated member's slot",
      )
    }
    if (
      slotToClose.type === 'human' ||
      slotToClose.type === 'computer' ||
      slotToClose.type === 'observer'
    ) {
      // Removing the occupant of the slot being closed must not let someone waiting on the bench
      // take it, since the whole point of the request is to take that slot out of the lobby.
      this._kickPlayerFromLobby(lobby, teamIndex!, slotIndex!, slotToClose, false)
    }

    // If the closed slot held the lobby's last human, the kick above already tore the lobby down
    // and published its removal. There is nothing left to close.
    const afterKick = this.lobbies.get(lobby.id)
    if (!afterKick) {
      return
    }

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
    // In controlled game types, removing the occupant can have dissolved a whole team into open
    // slots (only the target slot gets closed afterwards), so someone waiting may have a seat now
    updated = this._seatBenchOverflow(updated)
    this.lobbies.set(lobby.id, updated)
    this._publishLobbyDiff(afterKick, updated)
    this._warmLobbyRegions(updated)
  }

  kickPlayer({
    client,
    lobbyId,
    slotId,
  }: {
    client: ClientSocketsGroup
    lobbyId?: SbLobbyId
    slotId: string
  }): void {
    const lobby = this.getLobbyForClient(client, lobbyId)
    const [, , player] = findSlotByUserId(lobby, client.userId)
    this.ensureIsLobbyHost(lobby, player)

    const [teamIndex, slotIndex, playerToKick] = findSlotById(lobby, slotId)
    const benched = playerToKick ? undefined : findBenchedTarget(lobby, slotId)
    this.ensureHostCanRemove(lobby, !!benched)

    if (benched) {
      this._removeUserFromLobby(lobby, benched.userId, REMOVAL_TYPE_KICK)
      return
    }
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

  _kickPlayerFromLobby(
    lobby: Lobby,
    teamIndex: number,
    slotIndex: number,
    playerToKick: Slot,
    seatFromBench = true,
  ) {
    if (playerToKick.type === 'computer') {
      // NOTE(tec27): We know that removing a computer can never result in an empty lobby since a
      // human has to do it
      let updated = Lobbies.removePlayer(lobby, teamIndex, slotIndex, playerToKick)!
      if (seatFromBench) {
        updated = this._seatBenchOverflow(updated)
      }
      this.lobbies.set(lobby.id, updated)
      this._publishLobbyDiff(lobby, updated)
      this._warmLobbyRegions(updated)
    } else if (playerToKick.type === 'human' || playerToKick.type === 'observer') {
      this._removeUserFromLobby(lobby, playerToKick.userId!, REMOVAL_TYPE_KICK, seatFromBench)
    }
  }

  /** Removes a member from a lobby by user id, failing if they have no client to remove. */
  private _removeUserFromLobby(
    lobby: Lobby,
    userId: SbUserId,
    removalType: number,
    seatFromBench = true,
  ) {
    const client = this.activityRegistry.getClientForUser(userId)
    if (!client) {
      throw new LobbyServiceError(
        LobbyServiceErrorCode.TargetNoActiveClient,
        'target player has no active client',
      )
    }
    this._removeClientFromLobby(lobby, client, removalType, seatFromBench)
  }

  banPlayer({
    client,
    lobbyId,
    slotId,
  }: {
    client: ClientSocketsGroup
    lobbyId?: SbLobbyId
    slotId: string
  }): void {
    const lobby = this.getLobbyForClient(client, lobbyId)
    const [, , player] = findSlotByUserId(lobby, client.userId)
    this.ensureIsLobbyHost(lobby, player)

    const [, , playerToBan] = findSlotById(lobby, slotId)
    const benched = playerToBan ? undefined : findBenchedTarget(lobby, slotId)
    this.ensureHostCanRemove(lobby, !!benched)

    if (!playerToBan && !benched) {
      throw new LobbyServiceError(LobbyServiceErrorCode.InvalidSlotId, 'invalid slot id')
    }
    if (playerToBan && playerToBan.type !== 'human' && playerToBan.type !== 'observer') {
      throw new LobbyServiceError(LobbyServiceErrorCode.InvalidSlotType, 'invalid slot type')
    }
    const userToBan = playerToBan ? playerToBan.userId! : benched!.userId

    let bannedUsers = this.lobbyBannedUsers.get(lobby.id)
    if (!bannedUsers) {
      bannedUsers = new Set()
      this.lobbyBannedUsers.set(lobby.id, bannedUsers)
    }
    bannedUsers.add(userToBan)

    this._removeUserFromLobby(lobby, userToBan, REMOVAL_TYPE_BAN)
  }

  makeObserver({
    client,
    lobbyId,
    slotId,
  }: {
    client: ClientSocketsGroup
    lobbyId?: SbLobbyId
    slotId: string
  }): void {
    const lobby = this.getLobbyForClient(client, lobbyId)
    const [, , player] = findSlotByUserId(lobby, client.userId)
    this.ensureIsLobbyHost(lobby, player)
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
    updated = this._seatBenchOverflow(updated)
    this.lobbies.set(lobby.id, updated)
    this._publishLobbyDiff(lobby, updated)
    this._warmLobbyRegions(updated)
  }

  removeObserver({
    client,
    lobbyId,
    slotId,
  }: {
    client: ClientSocketsGroup
    lobbyId?: SbLobbyId
    slotId: string
  }): void {
    const lobby = this.getLobbyForClient(client, lobbyId)
    const [, , player] = findSlotByUserId(lobby, client.userId)
    this.ensureIsLobbyHost(lobby, player)
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
    // The observer slot they vacated is open now, so someone waiting on the bench may have a seat
    updated = this._seatBenchOverflow(updated)
    this.lobbies.set(lobby.id, updated)
    this._publishLobbyDiff(lobby, updated)
    this._warmLobbyRegions(updated)
  }

  leaveLobby({ client, lobbyId }: { client: ClientSocketsGroup; lobbyId?: SbLobbyId }): void {
    const lobby = this.getLobbyForClient(client, lobbyId)
    this._removeClientFromLobby(lobby, client)
  }

  /**
   * Removes `client` from whatever lobby it's currently seated in, if any. For flows that trade
   * the current lobby for another (joining elsewhere, creating a new one), call this only after
   * every failure check on the target has passed, so a failed request never strands the client
   * lobby-less. This also frees the activity registry entry that `registerActiveClient` needs,
   * the same way an explicit leave does (host-migration/close-when-empty semantics apply as
   * usual).
   */
  _leaveCurrentLobby(client: ClientSocketsGroup): void {
    if (!this.lobbyClients.has(client)) {
      return
    }

    const currentLobby = this.lobbies.get(this.lobbyClients.get(client)!)
    if (currentLobby) {
      this._removeClientFromLobby(currentLobby, client)
    }
  }

  /**
   * Seats the members waiting on the bench, longest-waiting first, for as long as the lobby has
   * both someone waiting and a slot they could have joined into directly. Also picks a new host if
   * the lobby's is gone, which is how a lobby whose last seated member left is handed to whoever
   * was waiting behind them.
   *
   * While a game is running the lobby's seats are that game's roster, so nobody is seated into one
   * that opens up; the bench is drained instead when the lobby regroups. A new host is still picked,
   * since a lobby whose host walks out mid-game needs one regardless.
   */
  private _seatBenchOverflow(lobby: Lobby): Lobby {
    if (this.runStates.has(lobby.id)) {
      return Lobbies.reassignHost(lobby)
    }

    let updated = lobby
    while (updated.bench.length > 0) {
      const [teamIndex, slotIndex] = Lobbies.findAvailableSlot(updated)
      if (teamIndex === undefined || slotIndex === undefined) {
        break
      }
      updated = Lobbies.seatBenchedUser(updated, updated.bench[0].userId, teamIndex, slotIndex)
    }
    return Lobbies.reassignHost(updated)
  }

  _removeClientFromLobby(
    lobby: Lobby,
    client: ClientSocketsGroup,
    removalType = REMOVAL_TYPE_NORMAL,
    seatFromBench = true,
  ) {
    // Someone who disappears mid-game is out of it as far as the lobby is concerned, or the lobby
    // would sit `inGame` forever waiting on a client that is never coming back.
    const wasInGame = this.runStates.get(lobby.id)?.inGameUsers.delete(client.userId) ?? false

    const [teamIndex, slotIndex, player] = findSlotByUserId(lobby, client.userId)
    let updatedLobby: Lobby | undefined
    if (player) {
      updatedLobby = Lobbies.removePlayer(lobby, teamIndex!, slotIndex!, player)
      if (updatedLobby && seatFromBench) {
        updatedLobby = this._seatBenchOverflow(updatedLobby)
      }
    } else {
      // A member waiting on the bench occupies no slot, so nothing opens up by their leaving.
      const withoutMember = Lobbies.removeFromBench(lobby, client.userId)
      updatedLobby = isLobbyEmpty(withoutMember) ? undefined : withoutMember
    }
    const lobbyIsEmpty = !updatedLobby

    if (!updatedLobby) {
      // The lobby is now empty and needs to be removed from the list

      // Ensure the client's local state gets updated to confirm the leave
      this._publishTo(
        lobby,
        player
          ? { type: 'leave', player }
          : { type: 'benchRemove', userId: client.userId, reason: 'left' },
      )
      this.lobbies.delete(lobby.id)
      this.lobbyBannedUsers.delete(lobby.id)
      this.runStates.delete(lobby.id)
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

    // A benched member holds no slot in the game being loaded, so their departure can't invalidate
    // a countdown or load in progress
    if (player) {
      this._maybeCancelCountdown(lobby, lobbyIsEmpty)
      this._maybeCancelLoading(lobby, lobbyIsEmpty)
    }
    if (!lobbyIsEmpty && wasInGame) {
      this._maybeRegroup(lobby.id)
    }

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

  startCountdown({
    client,
    lobbyId: expectedLobbyId,
  }: {
    client: ClientSocketsGroup
    lobbyId?: SbLobbyId
  }): void {
    const lobby = this.getLobbyForClient(client, expectedLobbyId)
    if (!hasOpposingSides(lobby)) {
      throw new LobbyServiceError(
        LobbyServiceErrorCode.NotEnoughSides,
        'must have at least 2 opposing sides',
      )
    }

    const [, , player] = findSlotByUserId(lobby, client.userId)
    this.ensureIsLobbyHost(lobby, player)
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

    // The countdown and game load run to completion on their own: every failure downstream of
    // this point resolves into cancel events published to the lobby rather than an error to the
    // caller, so the operation is done (as far as the caller is concerned) once the countdown has
    // begun.
    this._runCountdownAndLoad(lobby, gameConfig, countdownTimer).catch(swallowNonBuiltins)
  }

  private async _runCountdownAndLoad(
    lobby: Lobby,
    gameConfig: GameConfig,
    countdownTimer: Deferred<void>,
  ): Promise<void> {
    const lobbyId = lobby.id
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

      // Works from the live lobby rather than the snapshot the countdown started with (bench
      // members come and go freely during a countdown/load). Ids are never reused, so its presence
      // means it is this same lobby; its absence means everyone left while it loaded.
      this._onGameStarted(lobbyId, gameLoadResult.value.gameId)
    } catch (err) {
      if (err instanceof BaseGameLoaderError) {
        if (err.code === GameLoadErrorType.Internal) {
          logger.error({ err }, 'error loading game for lobby')
        }
      } else if (!(err instanceof CountdownCanceledError)) {
        logger.error({ err }, 'unexpected error while loading game for lobby')
      }

      // Same as above: cancellation works from the live lobby, which can have been updated (not
      // just replaced wholesale) since the countdown began
      const current = this.lobbies.get(lobbyId)
      if (current) {
        this._maybeCancelCountdown(current, false)
        this._maybeCancelLoading(current, false, usersAtFault)
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

  /**
   * Hands a lobby over to the game it just launched: the lobby stays exactly as it is, with its
   * members still in it and still holding their gameplay activity, and simply reports that a game
   * is running. It goes back to gathering once that game is over for every member (see
   * `_maybeRegroup`).
   *
   * The members registered as being in the game are the seated ones (players and observers alike) —
   * the bench takes no part in it and is free to keep filling up while it runs.
   */
  _onGameStarted(lobbyId: SbLobbyId, gameId: string) {
    this.loadingLobbies.delete(lobbyId)
    const lobby = this.lobbies.get(lobbyId)
    if (!lobby) {
      // Everyone left while the game was loading, so there's no lobby left for it to belong to.
      return
    }

    this.runStates.set(lobbyId, {
      gameId,
      inGameUsers: new Set(getHumanSlots(lobby).map(slot => slot.userId!)),
    })

    this._publishTo(lobby, { type: 'gameStarted', runState: this._runStateJson(lobbyId)! })
    // The lobby left the public list when its countdown began; it belongs back on it now, marked as
    // having a game in progress, since it can be joined (onto the bench) again.
    this._publishListChange('add', lobby)
  }

  /**
   * Records that one member's game is over and puts them back in the lobby, regrouping the lobby
   * once the last of them is done.
   *
   * The signals that trigger this arrive at least once per member and can arrive for a member who
   * has already left or whose lobby has moved on to another game, so everything about the member and
   * the game is checked before anything is changed.
   */
  private _onUserGameEnded(gameId: string, userId: SbUserId) {
    const client = this.activityRegistry.getClientForUser(userId)
    const lobbyId = client ? this.lobbyClients.get(client) : undefined
    if (lobbyId === undefined) {
      return
    }
    const runState = this.runStates.get(lobbyId)
    if (!runState || runState.gameId !== gameId || !runState.inGameUsers.has(userId)) {
      return
    }
    const lobby = this.lobbies.get(lobbyId)
    if (!lobby) {
      return
    }

    runState.inGameUsers.delete(userId)
    this._publishTo(lobby, { type: 'memberGameEnded', userId })
    this._maybeRegroup(lobbyId)
  }

  /**
   * Puts a lobby back to gathering once nobody is left in its game, keeping the seats and races it
   * had, and finally letting anyone who joined the bench during the game take a free seat.
   *
   * No-op while anyone is still playing.
   */
  private _maybeRegroup(lobbyId: SbLobbyId) {
    const runState = this.runStates.get(lobbyId)
    if (!runState || runState.inGameUsers.size > 0) {
      return
    }

    this.runStates.delete(lobbyId)
    const lobby = this.lobbies.get(lobbyId)
    if (!lobby) {
      return
    }

    const updated = this._seatBenchOverflow(lobby)
    this.lobbies.set(lobbyId, updated)
    this._publishTo(updated, { type: 'regroup', gameId: runState.gameId })
    if (updated === lobby) {
      // The lobby itself is unchanged, but its list entry still has to be refreshed: what changed is
      // its lifecycle.
      this._publishListChange('update', updated)
    } else {
      this._publishLobbyDiff(lobby, updated)
      this._warmLobbyRegions(updated)
    }
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

  /**
   * Returns the lobby the given client currently occupies.
   *
   * A client can only ever be in one lobby, so the lobby an operation applies to is derived from the
   * acting client rather than named by the caller. `expectedId`, when given, additionally asserts
   * that the derived lobby is the one the caller meant: a client that has moved on (a stale tab, a
   * request in flight across a leave) would otherwise silently act on whatever lobby it is in now.
   */
  getLobbyForClient(client: ClientSocketsGroup, expectedId?: SbLobbyId): Lobby {
    if (!this.lobbyClients.has(client)) {
      throw new LobbyServiceError(LobbyServiceErrorCode.NotInLobby, 'must be in a lobby')
    }
    const lobby = this.lobbies.get(this.lobbyClients.get(client)!)!
    if (expectedId !== undefined && lobby.id !== expectedId) {
      throw new LobbyServiceError(LobbyServiceErrorCode.NotInLobby, 'not in that lobby')
    }
    return lobby
  }

  /**
   * Throws unless `player` is the slot the lobby's host occupies. A member with no slot (someone
   * waiting on the bench) is never the host, so an absent slot fails the same way.
   */
  ensureIsLobbyHost(lobby: Lobby, player: Slot | undefined) {
    if (player?.id !== lobby.host.id) {
      throw new LobbyServiceError(LobbyServiceErrorCode.NotHost, 'must be a lobby host')
    }
  }

  ensureLobbyNotLoading(lobby: Lobby) {
    if (this.loadingLobbies.has(lobby.id)) {
      throw new LobbyServiceError(LobbyServiceErrorCode.AlreadyStarted, 'lobby has already started')
    }
  }

  // Ensures that the lobby is not on its way into a game, that is, in a state between being a lobby
  // and having an active game (counting down, loading). Those states can be rolled back, bringing
  // the lobby back to gathering.
  ensureLobbyNotStarting(lobby: Lobby) {
    if (this.lobbyCountdowns.has(lobby.id)) {
      throw new LobbyServiceError(LobbyServiceErrorCode.CountingDown, 'lobby is counting down')
    }
    if (this.loadingLobbies.has(lobby.id)) {
      throw new LobbyServiceError(LobbyServiceErrorCode.AlreadyStarted, 'lobby has already started')
    }
  }

  /**
   * Ensures that the lobby is in a state where its contents can be rearranged: not on its way into a
   * game, and not holding the roster of one that is running.
   */
  ensureLobbyNotTransient(lobby: Lobby) {
    this.ensureLobbyNotStarting(lobby)
    if (this.runStates.has(lobby.id)) {
      throw new LobbyServiceError(
        LobbyServiceErrorCode.GameInProgress,
        'lobby has a game in progress',
      )
    }
  }

  /**
   * Ensures the host may remove the member they named. While a game is running the seats hold the
   * people playing it and are off limits, but the bench takes no part in the game and stays the
   * host's to manage.
   */
  private ensureHostCanRemove(lobby: Lobby, targetIsBenched: boolean) {
    if (targetIsBenched) {
      this.ensureLobbyNotStarting(lobby)
    } else {
      this.ensureLobbyNotTransient(lobby)
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
   * Publishes a change to the public lobby list.
   *
   * A lobby's id is the capability that lets someone join it, so nothing about an unlisted lobby
   * (not even the bare id in a `delete`) may reach the public list channel. Every list publish must
   * go through here so that filtering can't be forgotten at a callsite.
   *
   * Only a lobby entering or leaving the list can change the open-lobby count, so only those
   * refresh it. That count channel reaches every connected client on the server, whether or not
   * they're anywhere near the lobby browser.
   */
  _publishListChange(action: 'add' | 'delete' | 'update', lobby: Lobby) {
    if (lobby.visibility === 'listed') {
      this.publisher.publish(LOBBY_LIST_PATH, {
        action,
        payload:
          action === 'delete'
            ? lobby.id
            : Lobbies.toSummaryJson(lobby, this._lifecycleOf(lobby.id)),
      })
    }
    if (action !== 'update') {
      this._publishLobbiesCount()
    }
  }

  /** Publishes a lobby's current seat-by-seat layout to whoever is previewing it. */
  _publishPreview(lobby: Lobby, summary?: LobbySummaryJson) {
    this.publisher.publish(getLobbyPreviewPath(lobby.id), {
      action: 'preview',
      payload: Lobbies.toPreviewJson(lobby, summary ?? this._toSummaryJson(lobby)),
    })
  }

  /**
   * Returns the full preview of a lobby by id, or undefined if no such lobby exists. A
   * counting-down or loading lobby can't be joined, so it's reported as gone rather than as a
   * live roster with join buttons behind it, matching the unauthenticated summary endpoint.
   */
  getPreview(lobbyId: SbLobbyId): LobbyPreviewJson | undefined {
    const lobby = this.lobbies.get(lobbyId)
    if (!lobby || this.lobbyCountdowns.has(lobbyId) || this.loadingLobbies.has(lobbyId)) {
      return undefined
    }
    return Lobbies.toPreviewJson(lobby, this._toSummaryJson(lobby))
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

      // Everything else about a kept slot - a new position, or in-place changes like a controlled
      // slot's controller handoff - is communicated by re-sending the whole slot
      diffEvents.push({
        type: 'slotChange',
        teamIndex: newTeamIndex,
        slotIndex: newSlotIndex,
        player: newSlot,
      })
      if (samePlace && oldSlot.race !== newSlot.race) {
        diffEvents.push({
          type: 'raceChange',
          teamIndex: newTeamIndex,
          slotIndex: newSlotIndex,
          newRace: newSlot.race,
        })
      }
    }

    // The bench is diffed after the slots, so that someone who was waiting and has just been seated
    // is reported as leaving the bench only once the slot they went to has been described.
    const oldBench = new Set(oldLobby.bench.map(benched => benched.userId))
    for (const benched of oldLobby.bench) {
      if (!newLobby.bench.some(entry => entry.userId === benched.userId)) {
        // Bench members hold no slot, so the slot-based leave/kick/ban events above never cover
        // them; when they're gone from the lobby entirely (rather than seated into one of its
        // slots), this event is the only report of their departure and has to say why itself.
        const seated = getLobbySlots(newLobby).some(slot => slot.userId === benched.userId)
        let reason: LobbyBenchRemoveEvent['reason']
        if (!seated) {
          if (kickedUser === benched.userId) {
            reason = 'kicked'
          } else if (bannedUser === benched.userId) {
            reason = 'banned'
          } else {
            reason = 'left'
          }
        }
        diffEvents.push({ type: 'benchRemove', userId: benched.userId, reason })
      }
    }
    for (const benched of newLobby.bench) {
      if (!oldBench.has(benched.userId)) {
        diffEvents.push({ type: 'benchAdd', user: benched })
      }
    }

    if (diffEvents.length) {
      this._publishTo(newLobby, {
        type: 'diff',
        diffEvents,
      })
    }

    // Previewers are looking at this lobby specifically and want every seat as it moves. Their
    // channel is empty whenever nobody has the lobby selected, so publishing unconditionally costs
    // nothing in the common case.
    const newSummary = this._toSummaryJson(newLobby)
    this._publishPreview(newLobby, newSummary)

    // The list, on the other hand, reaches every browser on the server, and its rows only show
    // the summary's scalars. A race pick leaves all of them identical, so republishing would wake
    // every subscriber to redraw nothing. (A seat swap does republish: it reorders the summary's
    // occupantIds, whose order is the seating order the friend stacks display.)
    if (JSON.stringify(this._toSummaryJson(oldLobby)) !== JSON.stringify(newSummary)) {
      this._publishListChange('update', newLobby)
    }
  }
}
