import { BasicChannelInfo } from '../chat'
import { GameServerRegionId } from '../game-server-regions'
import { GameType } from '../games/game-type'
import { MapImageInfo, MapInfoJson, SbMapId } from '../maps'
import { RaceChar } from '../races'
import { SbUser } from '../users/sb-user'
import { SbUserId } from '../users/sb-user-id'
import { BenchedUser, Lobby, LobbyState, LobbyVisibility } from './index'
import { SbLobbyId } from './sb-lobby-id'
import { SlotJson } from './slot'

/**
 * Machine-readable codes attached to the error body of failed lobby creation requests, so the
 * client can distinguish failures worth explaining specifically.
 */
export enum LobbyCreateErrorCode {
  NameTaken = 'nameTaken',
}

/**
 * Machine-readable codes attached to the error body of failed lobby join requests, so the client
 * can distinguish failures worth explaining specifically.
 */
export enum LobbyJoinErrorCode {
  NoLongerOpen = 'noLongerOpen',
  Full = 'full',
  Banned = 'banned',
  AlreadyStarted = 'alreadyStarted',
  AlreadyInActivity = 'alreadyInActivity',
}

/**
 * The parts of a lobby request that identify the acting client session. Lobby membership is tracked
 * per client (not per user), so every mutating request has to say which of the user's clients it is
 * coming from.
 */
export interface LobbyClientRequest {
  clientId: string
}

/**
 * A lobby occupant's netcode inputs, reported when they create or join a lobby: the home region
 * they chose (and the round-trip time they measured to it) plus their per-session netcode v2 public
 * key. All optional — a client with nothing measured, or one that can't reach the app, reports
 * none, and its slot is placed region-blind.
 */
export interface LobbyNetworkParams {
  region?: GameServerRegionId
  rttMs?: number
  clientPubkey?: string
}

/** The body of a request to create a new lobby. */
export interface CreateLobbyRequest extends LobbyClientRequest, LobbyNetworkParams {
  name: string
  map: SbMapId
  gameType: GameType
  gameSubType?: number
  allowObservers?: boolean
  useLegacyLimits?: boolean
  visibility?: LobbyVisibility
}

/** The response to a successful lobby creation, carrying the new lobby's id. */
export interface CreateLobbyResponse {
  id: SbLobbyId
}

/** The body of a request to join an existing lobby. */
export interface JoinLobbyRequest extends LobbyClientRequest, LobbyNetworkParams {}

/** The body of a request to send a chat message to a lobby. */
export interface SendLobbyChatRequest extends LobbyClientRequest {
  text: string
}

/** The body of a request that acts on a single slot of a lobby. */
export interface LobbySlotRequest extends LobbyClientRequest {
  slotId: string
}

/** The body of a request to set the race of a single slot of a lobby. */
export interface SetLobbyRaceRequest extends LobbySlotRequest {
  race: RaceChar
}

/** The response describing whether a lobby exists, and whether it can still be joined. */
export interface GetLobbyStateResponse {
  lobbyId: SbLobbyId
  lobbyState: LobbyState
}

/**
 * Where a lobby is in its life: gathering players, counting down or loading into a game, or with a
 * game in progress. A lobby exists until it's empty; games are things a lobby does, so `inGame`
 * flows back into `gathering` when its game ends.
 */
export type LobbyLifecycle = 'gathering' | 'countingDown' | 'loading' | 'inGame'

/** The running game of a lobby that is `inGame`, and which members are still in it. */
export interface LobbyRunStateJson {
  gameId: string
  inGameUsers: SbUserId[]
}

export type LobbyEvent =
  | LobbyInitEvent
  | LobbyDiffEvent
  | LobbySlotCreateEvent
  | LobbyRaceChangeEvent
  | LobbyLeaveEvent
  | LobbyKickEvent
  | LobbyBanEvent
  | LobbyHostChangeEvent
  | LobbySlotChangeEvent
  | LobbyStartCountdownEvent
  | LobbyCancelCountdownEvent
  | LobbyCancelLoadingEvent
  | LobbyGameStartedEvent
  | LobbyChatEvent
  | LobbyStatusEvent
  | LobbySettingsChangeEvent
  | LobbyBenchAddEvent
  | LobbyBenchRemoveEvent
  | LobbyMemberGameEndedEvent
  | LobbyRegroupEvent

export interface LobbySummaryJson {
  id: SbLobbyId
  name: string
  map: MapInfoJson
  gameType: GameType
  gameSubType: number
  host: { id: SbUserId }
  openSlotCount: number
  lifecycle: LobbyLifecycle
}

/**
 * The subset of a lobby's map info served to unauthenticated visitors: just enough to render the
 * landing page's map name and thumbnail (`MapImageInfo`). Deliberately excludes `mapUrl` (a
 * time-limited download link for the map file itself) and the uploader/hash/visibility details —
 * anyone holding a lobby link can call the summary endpoint, and they only need to see the map,
 * not fetch it.
 */
export interface LobbySummaryMapJson extends MapImageInfo {
  id: SbMapId
}

/**
 * The response of the unauthenticated lobby summary endpoint
 * (`GET /api/1/lobbies/:lobbyId/summary`), used by the logged-out web landing page for a lobby
 * link. Possessing a lobby's id is what grants access to this data (ids are unguessable, and for
 * unlisted lobbies the shared link is the invite), so it contains only what the landing page
 * shows.
 */
export interface LobbySummaryResponse {
  summary: Omit<LobbySummaryJson, 'map'> & { map: LobbySummaryMapJson }
  host: SbUser
}

export interface LobbyInitEvent {
  type: 'init'
  // TODO(tec27): actually type this. This is the lobby as the server JSON-serialized it, so e.g.
  // `map` is really a `MapInfoJson` rather than the full `MapInfo` that `Lobby` declares.
  lobby: Lobby
  /** The running game, when the lobby is `inGame` (e.g. for someone joining the bench mid-game). */
  runState?: LobbyRunStateJson
  /** An array of infos for all users that were in the lobby at this point. */
  userInfos: SbUser[]
}

export interface LobbyDiffEvent {
  type: 'diff'
  diffEvents: LobbyEvent[]
}

export interface LobbySlotCreateEvent {
  type: 'slotCreate'
  teamIndex: number
  slotIndex: number
  slot: SlotJson
}

export interface LobbyRaceChangeEvent {
  type: 'raceChange'
  teamIndex: number
  slotIndex: number
  newRace: RaceChar
}

export interface LobbyLeaveEvent {
  type: 'leave'
  player: SlotJson
}

export interface LobbyKickEvent {
  type: 'kick'
  player: SlotJson
}

export interface LobbyBanEvent {
  type: 'ban'
  player: SlotJson
}

export interface LobbyHostChangeEvent {
  type: 'hostChange'
  host: SlotJson
}

export interface LobbySlotChangeEvent {
  type: 'slotChange'
  teamIndex: number
  slotIndex: number
  player: SlotJson
}

export interface LobbyStartCountdownEvent {
  type: 'startCountdown'
}

export interface LobbyCancelCountdownEvent {
  type: 'cancelCountdown'
}

export interface LobbyCancelLoadingEvent {
  type: 'cancelLoading'
  usersAtFault?: SbUserId[]
}

export interface LobbyGameStartedEvent {
  type: 'gameStarted'
  runState: LobbyRunStateJson
}

/** A member's game ended and they are back in the lobby; the game itself may still be running. */
export interface LobbyMemberGameEndedEvent {
  type: 'memberGameEnded'
  userId: SbUserId
}

/**
 * The lobby's game is over for every member, and the lobby is gathering again with its seats and
 * races kept. Carries the finished game's id so clients can link its results.
 */
export interface LobbyRegroupEvent {
  type: 'regroup'
  gameId: string
}

export interface LobbyChatMessage {
  lobbyName: string
  time: number
  from: SbUserId
  text: string
}

export interface LobbyChatEvent {
  type: 'chat'
  message: LobbyChatMessage
  mentions: SbUser[]
  channelMentions: BasicChannelInfo[]
}

export interface LobbyStatusEvent {
  type: 'status'
}

/**
 * The body of a request by the host to change a gathering lobby's settings. Absent fields are left
 * as they are. Changing the map, game type, or sub-type rebuilds the slot layout and reconciles the
 * current members into it (seats kept where the layout allows, overflow to observer slots and then
 * the bench).
 */
export interface UpdateLobbySettingsRequest {
  clientId: string
  map?: SbMapId
  gameType?: GameType
  gameSubType?: number
  useLegacyLimits?: boolean
  allowObservers?: boolean
}

/** A lobby setting whose value changed, as reported in a `LobbySettingsChangeEvent`. */
export type LobbyChangedSetting =
  'map' | 'gameType' | 'gameSubType' | 'useLegacyLimits' | 'allowObservers'

/**
 * Published to a lobby when the host changes its settings. Slot reconciliation can restructure the
 * whole layout, so the event carries the complete new lobby rather than a diff; `changedSettings`
 * names what the host actually changed so clients can call it out.
 */
export interface LobbySettingsChangeEvent {
  type: 'settingsChange'
  changedSettings: LobbyChangedSetting[]
  // TODO(tec27): actually type this. This is the lobby as the server JSON-serialized it, so e.g.
  // `map` is really a `MapInfoJson` rather than the full `MapInfo` that `Lobby` declares.
  lobby: Lobby
}

/**
 * The body of a request by the host to move a seated player into another slot. An unoccupied
 * destination is a plain move; an occupied one swaps the two occupants.
 */
export interface MoveSlotRequest {
  clientId: string
  fromSlotId: string
  toSlotId: string
}

/** A diff event: someone joined the bench (joined while full, or was displaced by a layout change). */
export interface LobbyBenchAddEvent {
  type: 'benchAdd'
  user: BenchedUser
}

/**
 * A diff event: a bench member got a seat, left, or was removed by the host. Bench members hold no
 * slot, so unlike seated members they get no `leave`/`kick`/`ban` event — for anything but a
 * seating, this event is the only report of their departure, and `reason` says why they're gone.
 * An absent `reason` means they were seated, described by the slot events accompanying this one.
 */
export interface LobbyBenchRemoveEvent {
  type: 'benchRemove'
  userId: SbUserId
  reason?: 'left' | 'kicked' | 'banned'
}

/** The body of a request to update the current user's saved lobby creation preferences. */
export interface UpdateLobbyPreferencesRequest {
  name?: string
  gameType?: GameType
  gameSubType?: number
  recentMaps: SbMapId[]
  selectedMap?: SbMapId | null
  useLegacyLimits?: boolean
  visibility?: LobbyVisibility
  allowObservers?: boolean
}

/**
 * The current user's saved lobby creation preferences, with `recentMaps` resolved to full map
 * info instead of just ids.
 */
export interface LobbyPreferencesResponse {
  userId: SbUserId
  name?: string
  gameType?: GameType
  gameSubType?: number
  recentMaps: MapInfoJson[]
  /**
   * The last-selected map's id, or `null` if it's no longer present among `recentMaps` (e.g. it
   * was removed from recent maps by a later save).
   */
  selectedMap?: SbMapId | null
  useLegacyLimits?: boolean
  visibility?: LobbyVisibility
  allowObservers?: boolean
}
