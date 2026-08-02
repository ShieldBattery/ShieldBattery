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
 * Machine-readable codes attached to the error body of failed lobby join requests, so the client
 * can distinguish failures worth explaining specifically.
 */
export enum LobbyJoinErrorCode {
  NoLongerOpen = 'noLongerOpen',
  Full = 'full',
  ObserversFull = 'observersFull',
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
  /**
   * When set, a client currently in a different lobby is removed from it in the same operation
   * before hosting this one. Without it, being in any gameplay activity (including another lobby)
   * fails the create.
   */
  leaveCurrentLobby?: boolean
}

/** The response to a successful lobby creation, carrying the new lobby's id. */
export interface CreateLobbyResponse {
  id: SbLobbyId
}

/** The body of a request to join an existing lobby. */
export interface JoinLobbyRequest extends LobbyClientRequest, LobbyNetworkParams {
  /**
   * When set, the joiner wants an observer seat specifically: they take an open observer slot or
   * the join fails, rather than being seated as a player or benched.
   */
  asObserver?: boolean
  /**
   * When set, a client currently in a different lobby is removed from it in the same operation
   * before being seated in this one. Without it, being in any gameplay activity (including another
   * lobby) fails the join.
   */
  leaveCurrentLobby?: boolean
}

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

/**
 * A slot as shown to a lobby's previewers: its occupancy and just enough about the occupant to
 * render a preview row. Deliberately narrower than `SlotJson` — anyone holding a lobby's id can
 * watch its preview, so per-member details like chosen regions stay off it. Controlled open/closed
 * slots (team melee/FFA) read as plain open/closed here; UMS computers read as computers.
 */
export type LobbySummarySlotJson =
  | { type: 'open' }
  | { type: 'closed' }
  | { type: 'human'; userId: SbUserId; race: RaceChar }
  | { type: 'computer'; race: RaceChar }
  | { type: 'observer'; userId: SbUserId }

/** A team of a lobby's slot layout, as shown to a lobby's previewers. */
export interface LobbySummaryTeamJson {
  name: string
  isObserver: boolean
  slots: ReadonlyArray<LobbySummarySlotJson>
}

/**
 * The tally of a lobby's player seats: the ones people actually play from, humans and computers
 * alike, counted against every player slot the layout has (open and closed included). Observer
 * seats are counted separately — they're a different kind of spot, and folding them in would make
 * a 4-player map read as an 8-player one.
 */
export interface LobbyPlayerSlotCounts {
  taken: number
  total: number
  open: number
}

/** The tally of a lobby's observer seats: how many are filled, and how many anyone could take. */
export interface LobbyObserverSlotCounts {
  taken: number
  open: number
}

/**
 * A lobby as the public list channel carries it: everything a browser row shows plus what its
 * filters and sorts need, and nothing that changes when someone merely picks a race or swaps seats.
 * The list reaches every subscribed client on every change, so the seat-by-seat layout lives on the
 * per-lobby preview channel ({@link LobbyPreviewJson}) instead.
 */
export interface LobbySummaryJson {
  id: SbLobbyId
  name: string
  map: MapInfoJson
  gameType: GameType
  gameSubType: number
  host: { id: SbUserId }
  useLegacyLimits: boolean
  playerSlots: LobbyPlayerSlotCounts
  observerSlots: LobbyObserverSlotCounts
  /**
   * Whether the lobby has an observer team at all. Not derivable from `observerSlots`: a team whose
   * seats are all closed tallies 0 taken and 0 open, and still means the lobby allows observers.
   */
  hasObserverTeam: boolean
  /** Every seated person, players and observers alike, in the order they sit. */
  occupantIds: ReadonlyArray<SbUserId>
  /** When the lobby was created (Unix millis). */
  createdAt: number
}

/**
 * A single lobby as its previewers see it: its summary plus the seat-by-seat layout, so a browser
 * can show who is sitting where before joining. Published only on that lobby's preview channel,
 * which a client subscribes to one lobby at a time.
 */
export type LobbyPreviewJson = LobbySummaryJson & {
  teams: ReadonlyArray<LobbySummaryTeamJson>
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
  /**
   * Only what the landing page renders: who is inside (`occupantIds`) and how the lobby's observer
   * seats are arranged stay off an endpoint that answers anyone holding the link.
   */
  summary: Omit<
    LobbySummaryJson,
    'map' | 'createdAt' | 'observerSlots' | 'hasObserverTeam' | 'occupantIds'
  > & { map: LobbySummaryMapJson }
  host: SbUser
}

export interface LobbyInitEvent {
  type: 'init'
  // TODO(tec27): actually type this. This is the lobby as the server JSON-serialized it, so e.g.
  // `map` is really a `MapInfoJson` rather than the full `MapInfo` that `Lobby` declares.
  lobby: Lobby
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
