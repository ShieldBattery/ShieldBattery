import { BasicChannelInfo } from '../chat'
import { GameType } from '../games/game-type'
import { MapImageInfo, MapInfoJson, SbMapId } from '../maps'
import { SbUser } from '../users/sb-user'
import { SbUserId } from '../users/sb-user-id'
import { LobbyVisibility } from './index'
import { SbLobbyId } from './sb-lobby-id'
import { SlotJson } from './slot'

/**
 * Machine-readable codes attached to the error body of failed `/lobbies/create` invokes, so the
 * client can distinguish failures worth explaining specifically.
 */
export enum LobbyCreateErrorCode {
  NameTaken = 'nameTaken',
}

/**
 * Machine-readable codes attached to the error body of failed `/lobbies/join` invokes, so the
 * client can distinguish failures worth explaining specifically.
 */
export enum LobbyJoinErrorCode {
  NoLongerOpen = 'noLongerOpen',
  Full = 'full',
  Banned = 'banned',
  AlreadyStarted = 'alreadyStarted',
  AlreadyInActivity = 'alreadyInActivity',
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

export interface LobbySummaryJson {
  id: SbLobbyId
  name: string
  map: MapInfoJson
  gameType: GameType
  gameSubType: number
  host: { id: SbUserId }
  openSlotCount: number
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
  // TODO(tec27): actually type this
  lobby: {
    map: MapInfoJson
  }
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
  host: any
}

export interface LobbySlotChangeEvent {
  type: 'slotChange'
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
