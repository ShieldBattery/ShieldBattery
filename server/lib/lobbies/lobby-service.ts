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
  hasControlledOpens,
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
import { normalizeJoinCode } from '../../../common/lobbies/join-code'
import {
  LobbyBenchRemoveEvent,
  LobbyChangedSetting,
  LobbyInitEvent,
  LobbyLifecycle,
  LobbyPreviewJson,
  LobbyRunStateJson,
  LobbySeriesGameJson,
  LobbySeriesGameResultJson,
  LobbySeriesPlayerJson,
  LobbySeriesTeamJson,
  LobbyServiceErrorCode,
  LobbySlotCreateEvent,
  LobbySummaryJson,
} from '../../../common/lobbies/lobby-network'
import { SbLobbyId } from '../../../common/lobbies/sb-lobby-id'
import * as Slots from '../../../common/lobbies/slot'
import { Slot, SlotType } from '../../../common/lobbies/slot'
import { MapInfo, SbMapId } from '../../../common/maps'
import { RaceChar } from '../../../common/races'
import { multipleRandomItems } from '../../../common/random'
import { RolledOutcome, RolledOutcomeRequest } from '../../../common/rolled-outcomes'
import { urlPath } from '../../../common/urls'
import { FriendActivityStatus } from '../../../common/users/relationships'
import { RestrictionKind } from '../../../common/users/restrictions'
import { SbUser } from '../../../common/users/sb-user'
import { makeSbUserId, SbUserId } from '../../../common/users/sb-user-id'
import { FullChannelInfo, toBasicChannelInfo } from '../chat/chat-models'
import { CodedError } from '../errors/coded-error'
import { GameServerRegionsService } from '../game-server-regions/game-server-regions-service'
import { GameLifecycleEvents } from '../games/game-lifecycle-events'
import { BaseGameLoaderError, GameLoader, GameLoadErrorType } from '../games/game-loader'
import { getGameRecord } from '../games/game-models'
import { GameplayActivityRegistry } from '../games/gameplay-activity-registry'
import logger from '../logging/logger'
import { getMapInfos } from '../maps/map-models'
import { reparseMapsAsNeeded } from '../maps/map-operations'
import { emoteField } from '../messaging/emote-field'
import filterChatMessage from '../messaging/filter-chat-message'
import { outcomeField } from '../messaging/outcome-field'
import { processMessageContents } from '../messaging/process-chat-message'
import { rollOutcome } from '../messaging/roll-outcome'
import { NetcodeV2Service } from '../netcode-v2/netcode-v2-service'
import { Clock, TimeoutId } from '../time/clock'
import { IN_GAME_DISCONNECT_GRACE_MS } from '../users/activity-status-service'
import { genShortRandomCode } from '../users/random-code'
import { RestrictionService } from '../users/restriction-service'
import { findUsersById } from '../users/user-model'
import {
  ClientSocketsGroup,
  ClientSocketsManager,
  UserSocketsGroup,
  UserSocketsManager,
} from '../websockets/socket-groups'
import { TypedPublisher } from '../websockets/typed-publisher'
import * as Lobbies from './lobby'
import { LobbyPlayerNetworkStore } from './lobby-player-network-store'
import {
  setLobbyIdByJoinCodeGetter,
  setLobbyJoinCodeGetter,
  setLobbySummaryGetter,
} from './lobby-summaries'

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
  /** When the game started, for a summary's elapsed time. */
  startedAt: number
  /** Fires the stuck-game backstop, and is cancelled with the rest of this state. */
  deadlineTimer: TimeoutId
  /** The map the game is being played on. */
  mapId: SbMapId
  /**
   * Who is playing the game, captured as the lobby stood when it launched. The lobby keeps
   * rearranging itself while the game runs (and afterwards), so the roster has to be taken at the
   * moment it is still true.
   */
  teams: LobbySeriesTeamJson[]
}

/**
 * How long a lobby's game may run before the lobby stops waiting on it and regroups anyway. Some
 * games produce no end signal at all — a solo-vs-computers game has no relay session, and if its
 * StarCraft process dies abnormally the app reports nothing — and a lobby wedged in its in-game
 * state (host controls hidden, joins benched) until everyone leaves is worse than a regroup that
 * fires under a still-running marathon game, which the members can simply ignore.
 *
 * A regroup at this deadline is not an end the game itself agreed to: the members' clients may
 * still be playing and still treating the game as active, so the host gets the start button back
 * under a game nobody has signalled the end of. It is a backstop against a lobby stuck forever,
 * not a normal way for a game to finish.
 */
const MAX_IN_GAME_MS = 8 * 60 * 60 * 1000

/** Returns the user ids of everyone in a lobby, seated or waiting on the bench. */
function getLobbyMemberIds(lobby: Lobby): SbUserId[] {
  return [...getHumanSlots(lobby).map(slot => slot.userId!), ...lobby.bench.map(b => b.userId)]
}

/**
 * Captures the sides of the game a lobby is launching: each player team that has someone in it,
 * with everyone occupying one of its seats and the race they hold. Each side carries the lobby
 * team's own id, so it can be named the way the lobby's live layout names it however the roster is
 * arranged.
 *
 * The observer team is left out — observers are on nobody's side — as are teams nobody is in and
 * seats nobody occupies, so what remains is exactly the game's participants.
 */
function toSeriesTeams(lobby: Lobby): LobbySeriesTeamJson[] {
  const teams: LobbySeriesTeamJson[] = []
  for (const team of lobby.teams) {
    if (team.isObserver) {
      continue
    }

    const players: LobbySeriesPlayerJson[] = []
    for (const slot of team.slots) {
      if (slot.type === SlotType.Human) {
        players.push({ type: 'human', userId: slot.userId!, race: slot.race })
      } else if (slot.type === SlotType.Computer || slot.type === SlotType.UmsComputer) {
        players.push({ type: 'computer', race: slot.race })
      }
    }

    if (players.length) {
      // Game types whose teams aren't named carry an empty name, which is nothing to show
      teams.push({ teamId: team.teamId, ...(team.name ? { name: team.name } : {}), players })
    }
  }
  return teams
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

/**
 * Returns whether two versions of one slot differ in their race and in nothing else. Every field of
 * a `Slot` is a primitive, so comparing the value each key holds is an exact comparison of the two
 * slots.
 */
function onlyRaceDiffers(oldSlot: Slot, newSlot: Slot): boolean {
  if (oldSlot.race === newSlot.race) {
    return false
  }
  const keys = new Set([...Object.keys(oldSlot), ...Object.keys(newSlot)])
  keys.delete('race')
  for (const key of keys) {
    if (oldSlot[key as keyof Slot] !== newSlot[key as keyof Slot]) {
      return false
    }
  }
  return true
}

/**
 * Orders a lobby's dealable player seats so that filling them in order leaves its teams as evenly
 * sized as their seats allow: one seat from each team in turn, cycling, taking a team's own seats
 * in layout order and passing over a team whose seats are all spoken for.
 */
function orderSeatsRoundRobin(
  positions: ReadonlyArray<Lobbies.SlotPosition>,
): Lobbies.SlotPosition[] {
  const seatsByTeam = new Map<number, Lobbies.SlotPosition[]>()
  for (const position of positions) {
    const seats = seatsByTeam.get(position[0])
    if (seats) {
      seats.push(position)
    } else {
      seatsByTeam.set(position[0], [position])
    }
  }

  const teamSeats = [...seatsByTeam.values()]
  const mostSeats = Math.max(0, ...teamSeats.map(seats => seats.length))
  const ordered: Lobbies.SlotPosition[] = []
  for (let round = 0; round < mostSeats; round++) {
    for (const seats of teamSeats) {
      if (round < seats.length) {
        ordered.push(seats[round])
      }
    }
  }
  return ordered
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
  /**
   * The members of each lobby who have marked themselves ready for its next game. Only people
   * holding a slot are ever in here, and a lobby's set lives exactly as long as the lobby does.
   */
  readonly readyUsers = new Map<SbLobbyId, Set<SbUserId>>()
  /**
   * The games each lobby has played this session, oldest first.
   *
   * A lobby's history is bounded by the lobby's own lifetime rather than by a cap: a lobby closes
   * as soon as its last member leaves, a game takes minutes at minimum, and an entry is one small
   * roster, so even a marathon lobby accumulates a few dozen of them.
   */
  readonly series = new Map<SbLobbyId, LobbySeriesGameJson[]>()
  /**
   * The lobby waiting on each game's results, so a reconciliation that lands long after the game
   * ended can be routed back to the series entry it completes. An entry lives from the game's start
   * until its result is known (or its lobby closes).
   */
  readonly seriesGameLobbies = new Map<string, SbLobbyId>()
  readonly lobbyPlayerNetwork = new LobbyPlayerNetworkStore()
  /** A lobby's normalized join code, keyed by lobby id. Populated at create, gone once it closes. */
  private readonly lobbyJoinCodes = new Map<SbLobbyId, string>()
  /** The inverse of {@link lobbyJoinCodes}, for resolving a typed-in code back to its lobby. */
  private readonly joinCodeToLobby = new Map<string, SbLobbyId>()
  /**
   * The in-game members whose client has dropped and whose seat is being held until either the
   * client comes back or the grace period runs out, keyed by user id.
   */
  private readonly pendingDisconnects = new Map<
    SbUserId,
    { lobbyId: SbLobbyId; client: ClientSocketsGroup; timer: TimeoutId }
  >()

  // Every parameter is a dependency the container injects, so the count is a measure of what a
  // lobby touches rather than of what a caller has to assemble.
  // eslint-disable-next-line max-params
  constructor(
    private publisher: TypedPublisher<LobbyPublishEvent>,
    private activityRegistry: GameplayActivityRegistry,
    private gameLoader: GameLoader,
    private restrictionService: RestrictionService,
    private gameServerRegionsService: GameServerRegionsService,
    private netcodeV2Service: NetcodeV2Service,
    private userSockets: UserSocketsManager,
    private gameLifecycleEvents: GameLifecycleEvents,
    private clientSockets: ClientSocketsManager,
    private clock: Clock,
  ) {
    // Registers this instance's registry as the source of truth for `lobby-summaries`'s seam, so
    // the unauthenticated HTTP summary endpoint and the lobby page-metadata resolver can read a
    // live lobby's summary without depending on this service directly.
    //
    // Every live lobby reports itself, whatever it's currently doing: a summary carries the
    // lifecycle, so a reader can tell a lobby that's busy launching from one with open seats on its
    // own. Withholding the summary for the seconds a lobby spends counting down or loading would
    // instead make it indistinguishable from one that no longer exists -- a far longer-lived and
    // less recoverable thing to say about it.
    setLobbySummaryGetter(id => {
      const lobby = this.lobbies.get(id)
      return lobby ? this._toSummaryJson(lobby) : undefined
    })
    setLobbyJoinCodeGetter(id => this.lobbyJoinCodes.get(id))
    setLobbyIdByJoinCodeGetter(code => this.joinCodeToLobby.get(code))

    this.gameLifecycleEvents.on('userGameEnded', ({ gameId, userId }) => {
      try {
        this._onUserGameEnded(gameId, userId)
      } catch (err) {
        logger.error({ err }, 'error handling the end of a game for a lobby member')
      }
    })
    this.gameLifecycleEvents.on('gameEnded', ({ gameId }) => {
      try {
        this._onGameEnded(gameId)
      } catch (err) {
        logger.error({ err }, "error handling the end of a lobby's game")
      }
    })
    this.gameLifecycleEvents.on('gameReconciled', ({ gameId }) => {
      const lobbyId = this.seriesGameLobbies.get(gameId)
      if (lobbyId === undefined) {
        return
      }
      this._resolveSeriesGame(lobbyId, gameId).catch(err => {
        logger.error({ err }, "error recording the result of a lobby's game")
      })
    })
    this.clientSockets.on('newClient', client => {
      try {
        this._maybeResumeClient(client)
      } catch (err) {
        logger.error({ err }, 'error resuming a lobby member whose client reconnected')
      }
    })
  }

  /**
   * Mints a join code not currently held by any live lobby. Collisions are vanishingly rare (the
   * alphabet's ~113M six-character codes against at most hundreds of lobbies live at once), but
   * the retry loop exists so one could never hand out a code that resolves to someone else's
   * lobby.
   */
  private async _mintJoinCode(): Promise<string> {
    let code: string
    do {
      code = normalizeJoinCode(await genShortRandomCode())
    } while (this.joinCodeToLobby.has(code))
    return code
  }

  /** Removes a lobby's join code from both registry maps, symmetric with its other teardown state. */
  private _deleteJoinCode(lobbyId: SbLobbyId): void {
    const code = this.lobbyJoinCodes.get(lobbyId)
    this.lobbyJoinCodes.delete(lobbyId)
    if (code !== undefined) {
      this.joinCodeToLobby.delete(code)
    }
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

  /**
   * How long a lobby's game has been running, for a summary's `elapsedMs`. `undefined` when the
   * lobby has no game in progress.
   */
  private _elapsedMsOf(lobbyId: SbLobbyId): number | undefined {
    const runState = this.runStates.get(lobbyId)
    return runState ? this.clock.now() - runState.startedAt : undefined
  }

  /**
   * Serializes a lobby to its list/status summary, with its current lifecycle attached and a
   * freshly computed `elapsedMs` when it's `inGame`.
   */
  private _toSummaryJson(lobby: Lobby): LobbySummaryJson {
    return Lobbies.toSummaryJson(lobby, this._lifecycleOf(lobby.id), this._elapsedMsOf(lobby.id))
  }

  /** Serializes a lobby's ready members for the wire. */
  private _readyUsersJson(lobbyId: SbLobbyId): SbUserId[] {
    return [...(this.readyUsers.get(lobbyId) ?? [])]
  }

  /** Serializes the games a lobby has played for the wire, oldest first. */
  private _seriesJson(lobbyId: SbLobbyId): LobbySeriesGameJson[] {
    return [...(this.series.get(lobbyId) ?? [])]
  }

  /** Serializes a lobby's running game for the wire, or `undefined` if it has none. */
  private _runStateJson(lobbyId: SbLobbyId): LobbyRunStateJson | undefined {
    const runState = this.runStates.get(lobbyId)
    return runState
      ? {
          gameId: runState.gameId,
          inGameUsers: [...runState.inGameUsers],
          elapsedMs: this._elapsedMsOf(lobbyId)!,
        }
      : undefined
  }

  /**
   * Returns a summary of every lobby that belongs on the public lobby list.
   *
   * The list answers "what can I browse and join right now", so a lobby on its way into a game
   * drops off it until it settles -- deliberately a different question from the one
   * `setLobbySummaryGetter` answers, which is only whether the lobby exists.
   */
  getListedSummaries(): LobbySummaryJson[] {
    return [...this.lobbies.values()]
      .filter(l => l.visibility === 'listed')
      .map(l => [l, this._lifecycleOf(l.id)] as const)
      .filter(([, lifecycle]) => lifecycle !== 'countingDown' && lifecycle !== 'loading')
      .map(([lobby]) => this._toSummaryJson(lobby))
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
    regionManual,
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
    /** Whether `region` was hand-picked rather than resolved from the client's measurements. */
    regionManual?: boolean
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

    // Minted before any state mutation below: everything from the current-lobby leave onward must
    // stay a single synchronous block, both so no await window lets a concurrent create interleave
    // and so a (however unlikely) minting failure can't strand the client mid-mutation.
    const joinCode = await this._mintJoinCode()

    if (leaveCurrentLobby) {
      this._leaveCurrentLobby(client)
    }

    if (
      !this.activityRegistry.registerActiveClient(user.userId, client, FriendActivityStatus.InLobby)
    ) {
      throw new LobbyServiceError(
        LobbyServiceErrorCode.AlreadyInActivity,
        'user is already active in a gameplay activity',
      )
    }

    this.lobbies.set(lobby.id, lobby)
    this.lobbyJoinCodes.set(lobby.id, joinCode)
    this.joinCodeToLobby.set(joinCode, lobby.id)
    this.lobbyClients.set(client, lobby.id)
    if (rttMs !== undefined || regionManual !== undefined || clientPubkey !== undefined) {
      this.lobbyPlayerNetwork.set(lobby.id, client.userId, {
        rttMs,
        regionManual,
        netcodeV2Pubkey: clientPubkey,
      })
    }
    this._subscribeClientToLobby(lobby, user, client)

    this._publishListChange('add', lobby)

    return { id: lobby.id }
  }

  async joinLobby({
    id,
    region,
    rttMs,
    regionManual,
    clientPubkey,
    asObserver,
    leaveCurrentLobby,
    user,
    client,
  }: {
    id: SbLobbyId
    region?: GameServerRegionId
    rttMs?: number
    /** Whether `region` was hand-picked rather than resolved from the client's measurements. */
    regionManual?: boolean
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

    if (this.lobbyBannedUsers.get(lobby.id)?.has(client.userId)) {
      throw new LobbyServiceError(
        LobbyServiceErrorCode.Banned,
        'user has been banned from this lobby',
      )
    }

    let updated: Lobby
    if (lifecycle !== 'gathering') {
      // The lobby's seats, including its observer slots, belong to the game it is starting or
      // already running, so there is nothing a joiner can be seated into until it gathers again.
      // An observer request is no more seatable than a player request while that's true, so every
      // join waits on the bench here.
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

    if (
      !this.activityRegistry.registerActiveClient(user.userId, client, FriendActivityStatus.InLobby)
    ) {
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
    if (rttMs !== undefined || regionManual !== undefined || clientPubkey !== undefined) {
      this.lobbyPlayerNetwork.set(id, client.userId, {
        rttMs,
        regionManual,
        netcodeV2Pubkey: clientPubkey,
      })
    }

    this._publishLobbyDiff(lobby, updated)
    this._subscribeClientToLobby(lobby, user, client)
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
   * Best-effort signal to keep every region occupied by a human slot in this lobby warm when its
   * countdown begins, reducing the chance that its game waits for a relay to start.
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
    this._subscribeClientPathsToLobby(lobby, client)
    this._subscribeUserPathToLobby(lobby.id, user)
  }

  /**
   * Subscribes one client of a member to the channels that carry the lobby itself: the shared lobby
   * channel (whose initial data is the whole lobby) and the client's own channel.
   */
  private _subscribeClientPathsToLobby(lobby: Lobby, client: ClientSocketsGroup) {
    const lobbyId = lobby.id
    client.subscribe<LobbyInitEvent>(
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
            readyUsers: this._readyUsersJson(lobbyId),
            series: this._seriesJson(lobbyId),
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
            readyUsers: this._readyUsersJson(lobbyId),
            series: this._seriesJson(lobbyId),
          }
        }
      },
      client => {
        try {
          this._onClientClosed(lobbyId, client)
        } catch (err) {
          logger.warn({ err }, 'error removing client from lobby on disconnect')
        }
      },
    )
    client.subscribe(getLobbyClientPath(lobbyId, client.userId, client.clientId))
  }

  /** Subscribes a member's user-wide channel, which carries the lobby's summary to their clients. */
  private _subscribeUserPathToLobby(lobbyId: SbLobbyId, user: UserSocketsGroup) {
    user.subscribe(getLobbyUserPath(lobbyId, user.userId), () => {
      return {
        type: 'status',
        lobby: this._toSummaryJson(this.lobbies.get(lobbyId)!),
      }
    })
  }

  /**
   * Reacts to a member's client losing its last socket. A client that is in the middle of the
   * lobby's game keeps its seat for {@link IN_GAME_DISCONNECT_GRACE_MS}, so a network blip during a
   * long game doesn't hand the seat to someone on the bench and regroup the lobby under a game that
   * is still being played. Every other client is out of the lobby the moment it goes away.
   */
  private _onClientClosed(lobbyId: SbLobbyId, client: ClientSocketsGroup) {
    const lobby = this.lobbies.get(lobbyId)
    if (!lobby) {
      return
    }

    if (!this.runStates.get(lobbyId)?.inGameUsers.has(client.userId)) {
      this._removeClientFromLobby(lobby, client)
      return
    }

    const timer = this.clock.setTimeout(() => {
      this.pendingDisconnects.delete(client.userId)
      const current = this.lobbies.get(lobbyId)
      if (current && this.lobbyClients.get(client) === lobbyId) {
        this._removeClientFromLobby(current, client)
      }
    }, IN_GAME_DISCONNECT_GRACE_MS)
    this.pendingDisconnects.set(client.userId, { lobbyId, client, timer })
  }

  /**
   * Puts a member whose seat is being held back in their lobby when their client comes back, moving
   * the membership and the gameplay activity onto the new client group and re-subscribing it.
   *
   * Only the client that dropped resumes: a connection under a different client id is another app
   * instance entirely, which has its own idea of what it is doing and no claim on the held seat.
   */
  private _maybeResumeClient(client: ClientSocketsGroup) {
    const pending = this.pendingDisconnects.get(client.userId)
    if (!pending || pending.client.clientId !== client.clientId) {
      return
    }

    this.clock.clearTimeout(pending.timer)
    this.pendingDisconnects.delete(client.userId)

    const lobby = this.lobbies.get(pending.lobbyId)
    if (!lobby) {
      return
    }

    this.lobbyClients.delete(pending.client)
    this.lobbyClients.set(client, lobby.id)
    this.activityRegistry.rebindClient(client.userId, client)

    this._subscribeClientPathsToLobby(lobby, client)
    // A user's socket group is created after their first client's, so when the reconnecting client
    // is the only one they have, there is no user group to subscribe here yet. That path carries
    // only the lobby's summary for the user's *other* clients, and a user group that doesn't exist
    // has no other clients to carry it to.
    const user = this.userSockets.getById(client.userId)
    if (user) {
      this._subscribeUserPathToLobby(lobby.id, user)
    }
  }

  async sendChat({
    client,
    lobbyId,
    text,
    emote,
  }: {
    client: ClientSocketsGroup
    lobbyId?: SbLobbyId
    text: string
    emote?: boolean
  }): Promise<void> {
    const lobby = await this.ensureCanSendChat(client, lobbyId)

    const filtered = filterChatMessage(text)
    const [processedText, userMentions, channelMentions] = await processMessageContents(filtered)

    this.publishChat({
      lobby,
      userId: client.userId,
      text: processedText,
      userMentions,
      channelMentions,
      emote,
    })
  }

  /**
   * Settles an outcome (a roll, a coin flip, an 8-ball answer, a unit quote) for a client and
   * announces it to their lobby's chat as an action line.
   *
   * The line's wording is the client's to compose from the outcome, so the message's text carries
   * only the words the user typed themselves: the question put to the 8-ball, and nothing at all
   * for any other kind. Those words are never mention-processed, since an announcement the server
   * wrote must not become a way to make it notify people.
   */
  async sendOutcome({
    client,
    lobbyId,
    request,
  }: {
    client: ClientSocketsGroup
    lobbyId?: SbLobbyId
    request: RolledOutcomeRequest
  }): Promise<void> {
    const lobby = await this.ensureCanSendChat(client, lobbyId)

    this.publishChat({
      lobby,
      userId: client.userId,
      text: request.kind === 'eightBall' ? filterChatMessage(request.question) : '',
      userMentions: [],
      channelMentions: [],
      emote: true,
      outcome: rollOutcome(request),
    })
  }

  /**
   * Throws unless the client is allowed to post to their lobby's chat right now, returning the
   * lobby they are in.
   */
  private async ensureCanSendChat(client: ClientSocketsGroup, lobbyId?: SbLobbyId): Promise<Lobby> {
    const lobby = this.getLobbyForClient(client, lobbyId)

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

    return lobby
  }

  /**
   * Hands a chat message to everyone in a lobby. Lobby chat is never stored, so this is all a
   * message amounts to.
   */
  private publishChat({
    lobby,
    userId,
    text,
    userMentions,
    channelMentions,
    emote,
    outcome,
  }: {
    lobby: Lobby
    userId: SbUserId
    text: string
    userMentions: SbUser[]
    channelMentions: FullChannelInfo[]
    emote?: boolean
    outcome?: RolledOutcome
  }): void {
    this._publishTo(lobby, {
      type: 'chat',
      message: {
        lobbyName: lobby.name,
        time: Date.now(),
        from: userId,
        text,
        ...emoteField(emote),
        ...outcomeField(outcome),
      },
      mentions: userMentions,
      channelMentions: channelMentions.map(c => toBasicChannelInfo(c)),
    })
  }

  /**
   * Marks a member as ready for the lobby's next game, or takes that back.
   *
   * Players and observers holding a slot can ready up. The host is always ready, so their requests
   * are accepted as no-ops after the same membership and lifecycle validation. Members waiting on
   * the bench take no part in the next game, so they have nothing to be ready for. Setting the
   * value a member already holds is accepted and announces nothing.
   */
  setReady({
    client,
    lobbyId,
    isReady,
  }: {
    client: ClientSocketsGroup
    lobbyId?: SbLobbyId
    isReady: boolean
  }): void {
    const lobby = this.getLobbyForClient(client, lobbyId)
    // Ready marks describe the next game, so they can only be set while there is one to gather for:
    // once the lobby is on its way into a game, or running one, the marks are no longer the
    // members' to change.
    this.ensureLobbyNotTransient(lobby)

    const [, , player] = findSlotByUserId(lobby, client.userId)
    if (!player) {
      throw new LobbyServiceError(
        LobbyServiceErrorCode.NotSeated,
        'must hold a slot in the lobby to ready up',
      )
    }

    if (client.userId === lobby.host.userId) {
      return
    }

    let ready = this.readyUsers.get(lobby.id)
    if (isReady) {
      if (ready?.has(client.userId)) {
        return
      }
      if (!ready) {
        ready = new Set()
        this.readyUsers.set(lobby.id, ready)
      }
      ready.add(client.userId)
    } else if (!ready?.delete(client.userId)) {
      return
    }

    this._publishTo(lobby, { type: 'readyChange', userId: client.userId, isReady })
  }

  /**
   * Changes the settings of a lobby that is still gathering, reconciling everyone in it into the
   * layout the new settings describe.
   *
   * Settings that aren't named are left as they are. Since reconciliation can rearrange the whole
   * lobby, the occupants receive the result as a complete lobby rather than as a set of changes,
   * alongside the list of settings the host actually changed. Renaming the lobby is the one setting
   * that never reconciles slots: it applies as a plain field update, leaving every seat untouched.
   */
  async updateSettings({
    client,
    lobbyId,
    name,
    map,
    gameType,
    gameSubType,
    allowObservers,
    useLegacyLimits,
  }: {
    client: ClientSocketsGroup
    lobbyId?: SbLobbyId
    name?: string
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

    const nextName = name ?? current.name
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
    if (nextName !== current.name) changedSettings.push('name')
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

    // The name carries no slot layout of its own, so a rename alone must leave every seat exactly
    // as it was -- reconciliation only runs when some other setting is also changing.
    const needsReconciliation = changedSettings.some(setting => setting !== 'name')

    let updated: Lobby = current
    if (needsReconciliation) {
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
    }
    if (nextName !== current.name) {
      updated = { ...updated, name: nextName }
    }
    if (needsReconciliation) {
      // Everyone was ready for a different game than the one they are now looking at, so the lobby
      // gathers its ready marks again from scratch. A rename changes nothing about the game, so it
      // leaves them alone.
      this.readyUsers.delete(updated.id)
    }

    this.lobbies.set(updated.id, updated)
    this._publishTo(updated, {
      type: 'settingsChange',
      changedSettings,
      lobby: updated,
    })
    // A settings change can rearrange every seat in the lobby, so the people previewing it need the
    // new layout just as much as the people in it do.
    this._publishPreview(updated)
    this._publishListChange('update', updated)
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
      hasControlledOpens(lobby.gameType) &&
      sourceSlot.type === SlotType.Computer &&
      (destSlot.type === SlotType.ControlledOpen ||
        destSlot.type === SlotType.ControlledClosed ||
        !isSlotUnoccupied(destSlot))
    ) {
      // A controlled team is built around the people in it, so only they can enter one: a computer
      // team is moved or removed as a whole (a lone computer taken out of one would blank the rest
      // of its team), same as everywhere else computers are placed in these game types. Moving into
      // an *empty* team stays allowed — its plain open slots build a new team around the arrival.
      throw new LobbyServiceError(
        LobbyServiceErrorCode.InvalidSlotType,
        'only people can be moved in this game type',
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
    // A move leaves the slot its occupant came from open, so sending a player off to the observer
    // team frees up a player seat for someone waiting on the bench
    updated = this._seatBenchOverflow(updated)

    this.lobbies.set(lobby.id, updated)
    this._publishLobbyDiff(lobby, updated)
  }

  /**
   * Sends each of a lobby's two player teams to the other side: every occupant, human and computer
   * alike, ends up at the same position in the other team, keeping their race, and the seats the
   * host had opened or closed travel with them.
   *
   * Positions only correspond that way between two equally sized teams, so any other layout has
   * nothing to swap. A UMS lobby's teams are the map's own forces, and each of its slots carries the
   * player id and race the map assigns to that force, so its sides cannot trade places at all.
   */
  swapTeams({ client, lobbyId }: { client: ClientSocketsGroup; lobbyId?: SbLobbyId }): void {
    const lobby = this.getLobbyForClient(client, lobbyId)
    const [, , player] = findSlotByUserId(lobby, client.userId)
    this.ensureIsLobbyHost(lobby, player)
    this.ensureLobbyNotTransient(lobby)

    if (isUms(lobby.gameType)) {
      throw new LobbyServiceError(
        LobbyServiceErrorCode.InvalidTeamLayout,
        'the map defines the teams in this game type',
      )
    }

    const playerTeams = lobby.teams
      .map((team, teamIndex) => [teamIndex, team] as const)
      .filter(([, team]) => !team.isObserver)
    if (
      playerTeams.length !== 2 ||
      playerTeams[0][1].slots.length !== playerTeams[1][1].slots.length
    ) {
      throw new LobbyServiceError(
        LobbyServiceErrorCode.InvalidTeamLayout,
        'must have exactly 2 equally sized teams to swap them',
      )
    }

    const updated = Lobbies.swapTeams(lobby, playerTeams[0][0], playerTeams[1][0])
    this.lobbies.set(lobby.id, updated)
    this._publishLobbyDiff(lobby, updated)
  }

  /**
   * Deals a lobby's player-team occupants back out at random: everyone in a player team, human and
   * computer alike, lands in one of the seats those teams currently offer. Closed slots stay closed
   * and receive nobody, and the observer team and the bench are untouched.
   *
   * Only the order the occupants are dealt in is random; the seats are handed out one team at a
   * time in turn, so the teams come out as evenly filled as their seats allow. A layout with
   * opposing sides therefore still has them afterwards, instead of a run of luck collecting
   * everybody behind one of them.
   *
   * There is nothing to deal out unless the lobby has more than one team to deal between.
   */
  shuffleSlots({
    client,
    lobbyId,
    shuffleFn = occupants => multipleRandomItems(occupants.length, occupants),
  }: {
    client: ClientSocketsGroup
    lobbyId?: SbLobbyId
    /**
     * Decides the order the occupants are dealt in, by returning the positions they currently sit
     * at, permuted. Which seat each one then lands in is the deal's own business. Defaults to a
     * uniformly random permutation; a caller that needs a particular order passes its own.
     */
    shuffleFn?: (occupants: Lobbies.SlotPosition[]) => Lobbies.SlotPosition[]
  }): void {
    const lobby = this.getLobbyForClient(client, lobbyId)
    const [, , player] = findSlotByUserId(lobby, client.userId)
    this.ensureIsLobbyHost(lobby, player)
    this.ensureLobbyNotTransient(lobby)

    if (lobby.teams.filter(team => !team.isObserver).length < 2) {
      throw new LobbyServiceError(
        LobbyServiceErrorCode.InvalidTeamLayout,
        'must have at least 2 teams to shuffle between',
      )
    }
    if (
      hasControlledOpens(lobby.gameType) &&
      getLobbySlots(lobby).some(slot => slot.type === SlotType.Computer)
    ) {
      // In these game types a computer takes up a whole team rather than a seat of its own, so it
      // cannot be dealt into a team the people are being dealt into.
      throw new LobbyServiceError(
        LobbyServiceErrorCode.InvalidTeamLayout,
        'cannot shuffle a lobby whose teams hold computers in this game type',
      )
    }

    const positions = Lobbies.getPlayerSlotPositions(lobby)
    // Everything in `positions` is either occupied or an open seat, so the ones that aren't
    // unoccupied are exactly the occupants being dealt.
    const occupants = positions.filter(
      ([teamIndex, slotIndex]) => !isSlotUnoccupied(lobby.teams[teamIndex].slots[slotIndex]),
    )
    const seats = orderSeatsRoundRobin(positions)
    const seatByOccupantId = new Map<string, Lobbies.SlotPosition>()
    shuffleFn(occupants).forEach(([teamIndex, slotIndex], i) => {
      seatByOccupantId.set(lobby.teams[teamIndex].slots[slotIndex].id, seats[i])
    })

    let updated
    try {
      // `arrangeOccupants` fills the positions it is given with the occupants in layout order, so
      // each of them is named where it sits now; the seats nobody was dealt are the leftovers.
      updated = Lobbies.arrangeOccupants(lobby, [
        ...occupants.map(([teamIndex, slotIndex]) =>
          seatByOccupantId.get(lobby.teams[teamIndex].slots[slotIndex].id)!,
        ),
        ...seats.slice(occupants.length),
      ])
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
    // A seated member switching seats leaves their old slot open, so someone waiting on the bench
    // may have a player seat now
    updated = this._seatBenchOverflow(updated)
    this.lobbies.set(lobby.id, updated)
    this._publishLobbyDiff(lobby, updated)
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
    // The countdown snapshots the races into the game's configuration, so a change from here on
    // would show in the lobby and never reach the game being played.
    this.ensureLobbyNotTransient(lobby)
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
    // player slots (only the target slot gets closed afterwards), so someone waiting may have a
    // seat now
    updated = this._seatBenchOverflow(updated)
    this.lobbies.set(lobby.id, updated)
    this._publishLobbyDiff(afterKick, updated)
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
    if (!playerToKick) {
      const benched = findBenchedTarget(lobby, slotId)
      if (!benched) {
        // An id that names neither a slot nor someone on the bench is a bad request whatever the
        // lobby happens to be doing, so it is answered as one rather than as whatever a lobby in a
        // game would have refused first.
        throw new LobbyServiceError(LobbyServiceErrorCode.InvalidSlotId, 'invalid slot id')
      }

      this.ensureHostCanRemove(lobby, true)
      this._removeUserFromLobby(lobby, benched.userId, REMOVAL_TYPE_KICK)
      return
    }

    this.ensureHostCanRemove(lobby, false)
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
    if (!playerToBan && !benched) {
      // An id that names neither a slot nor someone on the bench is a bad request whatever the
      // lobby happens to be doing, so it is answered as one rather than as whatever a lobby in a
      // game would have refused first.
      throw new LobbyServiceError(LobbyServiceErrorCode.InvalidSlotId, 'invalid slot id')
    }

    this.ensureHostCanRemove(lobby, !!benched)
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
    this.lobbies.set(lobby.id, updated)
    this._publishLobbyDiff(lobby, updated)
  }

  /**
   * Takes the given client out of the lobby it occupies.
   *
   * Membership is per client, so the leave applies to the client that asked for it and no other:
   * one of a user's clients must not be able to leave on another's behalf, and a client that is in
   * a lobby must be able to leave it even when the user's registered active client is a different
   * one.
   */
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
   * both someone waiting and a player slot they could have joined into directly. Also picks a new
   * host if the lobby's is gone, which is how a lobby whose last seated member left is handed to
   * whoever was waiting behind them.
   *
   * A lobby that still has people waiting in it is never left with nobody seated, and so never
   * without a host to run it: when no slot holds anyone at all, the longest-waiting member takes
   * whatever slot is free, an observer slot included. That is the one case where waiting for a seat
   * lands someone in the observer team, and it jumps nobody's queue — there is nobody to jump.
   *
   * A lobby that is starting a game or running one has given its seats to that game, so nobody is
   * seated into one that opens up; the bench is drained instead once the lobby gathers again (when
   * it regroups, or when a launch is called off). A new host is still picked, since a lobby whose
   * host walks out mid-game needs one regardless.
   */
  private _seatBenchOverflow(lobby: Lobby): Lobby {
    if (this._lifecycleOf(lobby.id) !== 'gathering') {
      return Lobbies.reassignHost(lobby)
    }

    let updated = lobby
    while (updated.bench.length > 0) {
      const seat = Lobbies.findPlayerSeat(updated)
      if (!seat) {
        break
      }
      updated = Lobbies.seatBenchedUser(updated, updated.bench[0].userId, seat[0], seat[1])
    }

    if (updated.bench.length > 0 && getHumanSlots(updated).length === 0) {
      const [teamIndex, slotIndex] = Lobbies.findAvailableSlot(updated)
      if (teamIndex !== undefined && slotIndex !== undefined) {
        updated = Lobbies.seatBenchedUser(updated, updated.bench[0].userId, teamIndex, slotIndex)
      }
    }

    return Lobbies.reassignHost(updated)
  }

  _removeClientFromLobby(
    lobby: Lobby,
    client: ClientSocketsGroup,
    removalType = REMOVAL_TYPE_NORMAL,
    seatFromBench = true,
  ) {
    const pending = this.pendingDisconnects.get(client.userId)
    if (pending?.client === client) {
      // However this removal came about, the client it names is gone from the lobby now, so there
      // is no seat left to hold for it.
      this.clock.clearTimeout(pending.timer)
      this.pendingDisconnects.delete(client.userId)
    }

    // A client whose socket closes mid-game starts a grace period instead of arriving here, so a
    // member removed while the game runs is one whose grace ran out or who left outright. Either
    // way they are out of the game as far as the lobby is concerned, or it would sit `inGame`
    // forever waiting on a client that is never coming back.
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
      this._clearRunState(lobby.id)
      this.readyUsers.delete(lobby.id)
      this._forgetSeries(lobby.id)
      this.lobbyPlayerNetwork.deleteLobby(lobby.id)
      this._deleteJoinCode(lobby.id)
      this._publishListChange('delete', lobby)
    } else {
      this.lobbies.set(lobby.id, updatedLobby)
      // Ready marks belong to the people in the lobby, so someone who is out of it (having left,
      // been removed, or disconnected) no longer holds one.
      this.readyUsers.get(lobby.id)?.delete(client.userId)
      this.lobbyPlayerNetwork.deleteUser(lobby.id, client.userId)
      this._publishLobbyDiff(
        lobby,
        updatedLobby,
        removalType === REMOVAL_TYPE_KICK ? client.userId : undefined,
        removalType === REMOVAL_TYPE_BAN ? client.userId : undefined,
      )
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
      const cancelledCountdown = this._maybeCancelCountdown(lobby, lobbyIsEmpty)
      const cancelledLoading = this._maybeCancelLoading(lobby, lobbyIsEmpty)
      if (cancelledCountdown || cancelledLoading) {
        this._releaseLaunchBench(lobby.id)
      }
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
    force,
  }: {
    client: ClientSocketsGroup
    lobbyId?: SbLobbyId
    /**
     * When set, the lobby starts even though some of its seated members have not marked themselves
     * ready. This is the host's call to make, and they are the only one who can start a lobby at
     * all.
     */
    force?: boolean
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

    if (!force) {
      // Everyone else the game will contain gets a say in whether it starts. The host can start
      // the game without marking ready, while seated players and observers must still mark ready.
      const ready = this.readyUsers.get(lobby.id)
      if (
        getHumanSlots(lobby).some(
          slot => slot.userId !== lobby.host.userId && !ready?.has(slot.userId!),
        )
      ) {
        throw new LobbyServiceError(
          LobbyServiceErrorCode.NotEveryoneReady,
          'not everyone in the lobby is ready',
        )
      }
    }

    // Warm the lobby's regions during the countdown, before its session is created.
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

      const loadedPlayers = getHumanSlots(lobby).map(s => ({
        userId: s.userId!,
        isObserver: s.type === SlotType.Observer,
        region: s.region,
        rttMs: networkByUser.get(s.userId!)?.rttMs,
        regionManual: networkByUser.get(s.userId!)?.regionManual,
        netcodeV2Pubkey: networkByUser.get(s.userId!)?.netcodeV2Pubkey,
      }))
      const gameLoadResult = await this.gameLoader.loadGame({
        players: loadedPlayers,
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

      this._onGameStarted(
        lobbyId,
        gameLoadResult.value.gameId,
        loadedPlayers.map(p => p.userId),
      )
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
        const cancelledCountdown = this._maybeCancelCountdown(current, false)
        const cancelledLoading = this._maybeCancelLoading(current, false, usersAtFault)
        if (cancelledCountdown || cancelledLoading) {
          this._releaseLaunchBench(lobbyId)
        }
      }
    }
  }

  _maybeCancelLoading(lobby: Lobby, isLobbyEmpty = false, usersAtFault?: SbUserId[]): boolean {
    if (!this.loadingLobbies.has(lobby.id)) {
      // This lobby was closed before loading completed, likely because all the human users left or
      // disconnected.
      return false
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
    return true
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
  _onGameStarted(lobbyId: SbLobbyId, gameId: string, inGameUsers: ReadonlyArray<SbUserId>) {
    this.loadingLobbies.delete(lobbyId)
    // The game the members were ready for is the one that just started, so their marks are spent:
    // the next game gathers its own.
    this.readyUsers.delete(lobbyId)
    const lobby = this.lobbies.get(lobbyId)
    if (!lobby) {
      // Everyone left while the game was loading, so there's no lobby left for it to belong to.
      return
    }

    // The roster comes from the loader's snapshot rather than the live lobby: a join can land a
    // seat between the countdown snapshotting its players and the load finishing, and someone the
    // game never included must not be waited on to report its end.
    const runState: LobbyRunState = {
      gameId,
      inGameUsers: new Set(inGameUsers),
      startedAt: this.clock.now(),
      deadlineTimer: this.clock.setTimeout(() => {
        if (this.runStates.get(lobbyId) !== runState) {
          return
        }

        logger.warn(
          { lobbyId, gameId },
          'lobby game exceeded the in-game deadline without an end signal; regrouping',
        )
        this._endGameForEveryone(lobbyId, runState)
      }, MAX_IN_GAME_MS),
      mapId: lobby.map!.id,
      teams: toSeriesTeams(lobby),
    }
    this.runStates.set(lobbyId, runState)
    // The lobby is what remembers this game once it's over, so a result reconciled at any later
    // point has to be able to find its way back here.
    this.seriesGameLobbies.set(gameId, lobbyId)

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
    this.activityRegistry.reapplyStatus(userId)
    this._publishTo(lobby, { type: 'memberGameEnded', userId })
    this._maybeRegroup(lobbyId)
  }

  /**
   * Ends a lobby's game for everyone still marked as in it, for game-over observations that aren't
   * tied to any one player (the relay session closing, the reconcile sweep) — the only signal a
   * client that crashed without reporting anything will ever produce.
   */
  private _onGameEnded(gameId: string) {
    for (const [lobbyId, runState] of this.runStates) {
      if (runState.gameId === gameId) {
        this._endGameForEveryone(lobbyId, runState)
        return
      }
    }
  }

  /**
   * Ends a lobby's game for every member still marked as being in it and regroups the lobby, for
   * the end signals that speak for the whole game at once rather than for one member.
   */
  private _endGameForEveryone(lobbyId: SbLobbyId, runState: LobbyRunState) {
    for (const userId of runState.inGameUsers) {
      this.activityRegistry.reapplyStatus(userId)
    }
    runState.inGameUsers.clear()
    this._maybeRegroup(lobbyId)
  }

  /**
   * Puts a lobby back to gathering once nobody is left in its game, keeping the seats and races it
   * had, adding the finished game to what the lobby remembers of its session, and finally letting
   * anyone who joined the bench during the game take a free seat.
   *
   * No-op while anyone is still playing.
   */
  private _maybeRegroup(lobbyId: SbLobbyId) {
    const runState = this.runStates.get(lobbyId)
    if (!runState || runState.inGameUsers.size > 0) {
      return
    }

    this._clearRunState(lobbyId)
    // A lobby coming out of a game gathers for the next one with nobody ready yet, whatever it
    // held while the game ran.
    this.readyUsers.delete(lobbyId)
    const lobby = this.lobbies.get(lobbyId)
    if (!lobby) {
      return
    }

    // The game joins the lobby's history with no outcome yet: results are reconciled some time
    // after a game ends, and a game that reports none never gets one at all.
    const game: LobbySeriesGameJson = {
      gameId: runState.gameId,
      mapId: runState.mapId,
      teams: runState.teams,
    }
    const series = this.series.get(lobbyId)
    if (series) {
      series.push(game)
    } else {
      this.series.set(lobbyId, [game])
    }

    const updated = this._seatBenchOverflow(lobby)
    this.lobbies.set(lobbyId, updated)
    this._publishTo(updated, { type: 'regroup', game })
    if (updated === lobby) {
      // The lobby itself is unchanged, but its list entry still has to be refreshed: what changed is
      // its lifecycle.
      this._publishListChange('update', updated)
    } else {
      this._publishLobbyDiff(lobby, updated)
    }

    // Results are usually still being settled at this point, but a game that ended long enough ago
    // (or was reconciled while a member was slow to report) can already have them, and no further
    // signal would arrive for it. Regrouping stays synchronous either way.
    this._resolveSeriesGame(lobbyId, game.gameId).catch(err => {
      logger.error({ err }, "error recording the result of a lobby's game")
    })
  }

  /**
   * Fills in how a game in a lobby's series turned out, and tells the lobby, once that game's
   * results have been reconciled. Does nothing for a game whose outcome is already recorded or whose
   * results haven't settled yet.
   *
   * Both the regroup that adds a game to the series and the reconciliation of that game's results
   * lead here, in whichever order they happen, so this stays idempotent.
   */
  private async _resolveSeriesGame(lobbyId: SbLobbyId, gameId: string): Promise<void> {
    const entryBefore = this.series.get(lobbyId)?.find(game => game.gameId === gameId)
    if (!entryBefore) {
      return
    }
    if (entryBefore.result) {
      this.seriesGameLobbies.delete(gameId)
      return
    }

    const record = await getGameRecord(gameId)
    if (!record?.results || record.gameLength === null) {
      return
    }

    // The lobby can have closed, or the same game can have been resolved by the other path, while
    // the record was being fetched.
    const entry = this.series.get(lobbyId)?.find(game => game.gameId === gameId)
    if (!entry || entry.result) {
      return
    }

    const result: LobbySeriesGameResultJson = {
      outcomes: record.results.map(([userId, playerResult]) => ({
        userId,
        result: playerResult.result,
      })),
      durationMs: record.gameLength,
    }
    entry.result = result
    this.seriesGameLobbies.delete(gameId)

    const lobby = this.lobbies.get(lobbyId)
    if (lobby) {
      this._publishTo(lobby, { type: 'seriesGameUpdated', gameId, result })
    }
  }

  /** Drops everything a closed lobby remembered about the games it played. */
  private _forgetSeries(lobbyId: SbLobbyId) {
    this.series.delete(lobbyId)
    for (const [gameId, waitingLobbyId] of this.seriesGameLobbies) {
      if (waitingLobbyId === lobbyId) {
        this.seriesGameLobbies.delete(gameId)
      }
    }
  }

  /**
   * Calls off a countdown the host started, putting the lobby back to gathering with everything
   * (including who is ready) exactly as it was.
   *
   * Only the countdown can be called off this way: once the game is loading, the members' clients
   * are already committed to it, and it ends by loading or failing on its own.
   */
  cancelCountdown({ client, lobbyId }: { client: ClientSocketsGroup; lobbyId?: SbLobbyId }): void {
    const lobby = this.getLobbyForClient(client, lobbyId)
    const [, , player] = findSlotByUserId(lobby, client.userId)
    this.ensureIsLobbyHost(lobby, player)

    if (!this.lobbyCountdowns.has(lobby.id)) {
      throw new LobbyServiceError(
        LobbyServiceErrorCode.NotCountingDown,
        'lobby is not counting down',
      )
    }

    this._maybeCancelCountdown(lobby)
    this._releaseLaunchBench(lobby.id)
  }

  /** Drops a lobby's running game, cancelling the stuck-game deadline that came with it. */
  private _clearRunState(lobbyId: SbLobbyId) {
    const runState = this.runStates.get(lobbyId)
    if (!runState) {
      return
    }

    this.clock.clearTimeout(runState.deadlineTimer)
    this.runStates.delete(lobbyId)
  }

  /**
   * Seats whoever started waiting while the lobby was busy starting a game, now that it is
   * gathering again and its seats are its own once more. Reads the lobby back out of the registry
   * rather than taking it as an argument, since a caller that cancelled a countdown and a load in
   * turn holds a lobby from before either of them.
   *
   * Only for the transitions that end a launch. A lobby that was already gathering seats its own
   * bench as part of whatever freed the seat, and some of those callers deliberately leave a
   * vacated slot unfilled (`closeSlot` takes the slot out of the lobby entirely), so draining the
   * bench here as well would hand over a seat that was on its way out.
   */
  private _releaseLaunchBench(lobbyId: SbLobbyId): void {
    const lobby = this.lobbies.get(lobbyId)
    if (!lobby || lobby.bench.length === 0 || this._lifecycleOf(lobbyId) !== 'gathering') {
      return
    }

    const updated = this._seatBenchOverflow(lobby)
    if (updated === lobby) {
      return
    }

    this.lobbies.set(lobbyId, updated)
    this._publishLobbyDiff(lobby, updated)
    this._publishListChange('update', updated)
  }

  /** Cancels the countdown if one was occurring, returning whether there was one to cancel. */
  _maybeCancelCountdown(lobby: Lobby, isLobbyEmpty = false): boolean {
    if (!this.lobbyCountdowns.has(lobby.id)) {
      return false
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
    return true
  }

  getLobbyState({ lobbyId }: { lobbyId: SbLobbyId }): {
    lobbyId: SbLobbyId
    lobbyState: LobbyState
  } {
    const lobbyState: LobbyState = this.lobbies.has(lobbyId) ? 'exists' : 'nonexistent'
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
        payload: action === 'delete' ? lobby.id : this._toSummaryJson(lobby),
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
   * Returns the full preview of a lobby by id, or undefined if no such lobby exists. Where the
   * lobby is in its life makes no difference: every live lobby takes joins, and the summary the
   * preview carries says what it is doing, so existence is the only thing that can withhold one.
   */
  getPreview(lobbyId: SbLobbyId): LobbyPreviewJson | undefined {
    const lobby = this.lobbies.get(lobbyId)
    if (!lobby) {
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
    const hostUserChanged = newLobby.host.userId !== oldLobby.host.userId
    if (hostUserChanged) {
      // Ready marks belong to the person who chose them. A former host can remain seated after a
      // host transfer and must mark ready explicitly before the next game can start.
      this.readyUsers.get(oldLobby.id)?.delete(oldLobby.host.userId!)
    }
    if (newLobby.host.id !== oldLobby.host.id || hostUserChanged) {
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

      // The two events are alternatives, not a pair: a race pick is by far the most common change
      // to a kept slot and needs only the race sent, while everything else about one - a new
      // position, a controlled slot's controller handoff, a retype across the observer boundary -
      // is communicated by re-sending the whole slot.
      if (samePlace && onlyRaceDiffers(oldSlot, newSlot)) {
        diffEvents.push({
          type: 'raceChange',
          teamIndex: newTeamIndex,
          slotIndex: newSlotIndex,
          newRace: newSlot.race,
        })
      } else {
        diffEvents.push({
          type: 'slotChange',
          teamIndex: newTeamIndex,
          slotIndex: newSlotIndex,
          player: newSlot,
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
    const lifecycle = this._lifecycleOf(newLobby.id)
    const elapsedMs = this._elapsedMsOf(newLobby.id)
    const newSummary = Lobbies.toSummaryJson(newLobby, lifecycle, elapsedMs)
    this._publishPreview(newLobby, newSummary)

    // The list, on the other hand, reaches every browser on the server, and its rows only show
    // the summary's scalars. A race pick leaves all of them identical, so republishing would wake
    // every subscriber to redraw nothing. (A seat swap does republish: it reorders the summary's
    // occupantIds, whose order is the seating order the friend stacks display.)
    if (
      JSON.stringify(Lobbies.toSummaryJson(oldLobby, lifecycle, elapsedMs)) !==
      JSON.stringify(newSummary)
    ) {
      this._publishListChange('update', newLobby)
    }
  }
}
