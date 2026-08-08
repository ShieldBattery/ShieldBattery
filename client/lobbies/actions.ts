import {
  GetLobbyStateResponse,
  LobbyBanEvent,
  LobbyChatEvent,
  LobbyInitEvent,
  LobbyKickEvent,
  LobbyLeaveEvent,
  LobbyPreferencesResponse,
  LobbyPreviewJson,
  LobbyRaceChangeEvent,
  LobbySlotChangeEvent,
  LobbySlotCreateEvent,
  LobbySummaryJson,
} from '../../common/lobbies/lobby-network'
import { SbLobbyId } from '../../common/lobbies/sb-lobby-id'
import { Slot } from '../../common/lobbies/slot'
import { SbUserId } from '../../common/users/sb-user-id'
import { BaseFetchFailure } from '../network/fetch-errors'

export type LobbyActions =
  | LobbiesCountUpdate
  | GetLobbyStateBegin
  | GetLobbyStateSuccess
  | GetLobbyStateFailure
  | LobbiesListUpdate
  | LobbyPreviewSelect
  | LobbyPreviewUpdate
  | ActivateLobby
  | DeactivateLobby
  | LobbyInit
  | LobbyUpdateBan
  | LobbyUpdateBanSelf
  | LobbyUpdateChatMessage
  | LobbyUpdateCountdownCanceled
  | LobbyUpdateCountdownStart
  | LobbyUpdateCountdownTick
  | LobbyUpdateGameStarted
  | LobbyUpdateHostChange
  | LobbyUpdateKick
  | LobbyUpdateKickSelf
  | LobbyUpdateLeave
  | LobbyUpdateLeaveSelf
  | LobbyUpdateLoadingStart
  | LobbyUpdateLoadingCanceled
  | LobbyUpdateRaceChange
  | LobbyUpdateSlotChange
  | LobbyUpdateSlotCreate
  | GetLobbyPreferencesBegin
  | GetLobbyPreferencesSuccess
  | GetLobbyPreferencesFailure
  | UpdateLobbyPreferencesBegin
  | UpdateLobbyPreferencesSuccess
  | UpdateLobbyPreferencesFailure

/** The server has sent us an updated count on the number of active lobbies. */
export interface LobbiesCountUpdate {
  type: '@lobbies/countUpdate'
  payload: {
    count: number
  }
}

/** We are starting the process of getting the state of a particular lobby. */
export interface GetLobbyStateBegin {
  type: '@lobbies/getLobbyStateBegin'
  payload: {
    lobbyId: SbLobbyId
  }
}

/** The server has responded with the state of a lobby we asked about. */
export interface GetLobbyStateSuccess {
  type: '@lobbies/getLobbyState'
  payload: GetLobbyStateResponse
  meta: { lobbyId: SbLobbyId; requestTime: number }
  error?: false
}

export interface GetLobbyStateFailure extends BaseFetchFailure<'@lobbies/getLobbyState'> {
  meta: { lobbyId: SbLobbyId; requestTime: number }
}

/** The server has sent us an update to the lobby list (used for joining lobbies). */
export interface LobbiesListUpdate {
  type: '@lobbies/listUpdate'
  payload:
    | { message: 'full'; data: LobbySummaryJson[] }
    | { message: 'add' | 'update'; data: LobbySummaryJson }
    | { message: 'delete'; data: SbLobbyId }
}

/**
 * We are now previewing a particular lobby (or, with no id, none at all). Any layout already held
 * for a different lobby is dropped: a preview only ever describes the lobby named here.
 */
export interface LobbyPreviewSelect {
  type: '@lobbies/previewSelect'
  payload: {
    lobbyId?: SbLobbyId
  }
}

/** The server has sent us the seat-by-seat layout of a lobby we're previewing. */
export interface LobbyPreviewUpdate {
  type: '@lobbies/previewUpdate'
  payload: LobbyPreviewJson
}

/**
 * A user has brought a lobby into a visible state (and things like last read message should be
 * updated).
 */
export interface ActivateLobby {
  type: '@lobbies/activate'
}

/**
 * A lobby is no longer visible to the user, and can be cleaned up as appropriate (trimming its
 * message list to a minimal amount, for instance).
 */
export interface DeactivateLobby {
  type: '@lobbies/deactivate'
}

/** We are now in a lobby, this is the full lobby descriptor. */
export interface LobbyInit {
  type: '@lobbies/init'
  payload: LobbyInitEvent
}

/** A user has been banned in a lobby we're in. */
export interface LobbyUpdateBan {
  type: '@lobbies/updateBan'
  payload: LobbyBanEvent
}

/** We have been banned from a lobby. */
export interface LobbyUpdateBanSelf {
  type: '@lobbies/updateBanSelf'
}

/** A new chat message has been received. */
export interface LobbyUpdateChatMessage {
  type: '@lobbies/updateChatMessage'
  payload: LobbyChatEvent
}

/** The countdown for the lobby we're in has been canceled. */
export interface LobbyUpdateCountdownCanceled {
  type: '@lobbies/updateCountdownCanceled'
}

/** A lobby we're in is starting the game countdown. */
export interface LobbyUpdateCountdownStart {
  type: '@lobbies/updateCountdownStart'
  /** How many seconds are left before the game starts loading. */
  payload: number
}

/** A second has ticked off the countdown for a lobby we're in. */
export interface LobbyUpdateCountdownTick {
  type: '@lobbies/updateCountdownTick'
  /** How many seconds are left before the game starts loading. */
  payload: number
}

/** The game has been started and this lobby is now complete/closed. */
export interface LobbyUpdateGameStarted {
  type: '@lobbies/updateGameStarted'
}

/** A lobby we're in now has a new host player. */
export interface LobbyUpdateHostChange {
  type: '@lobbies/updateHostChange'
  /** The slot of the lobby's new host. */
  payload: Slot
}

/** A user has been kicked in a lobby we're in. */
export interface LobbyUpdateKick {
  type: '@lobbies/updateKick'
  payload: LobbyKickEvent
}

/** We have been kicked from a lobby. */
export interface LobbyUpdateKickSelf {
  type: '@lobbies/updateKickSelf'
}

/** A user has left a lobby we're in. */
export interface LobbyUpdateLeave {
  type: '@lobbies/updateLeave'
  payload: LobbyLeaveEvent
}

/** We have left a lobby we're in. */
export interface LobbyUpdateLeaveSelf {
  type: '@lobbies/updateLeaveSelf'
}

/** The lobby has entered the game setup phase (and we are loading the game). */
export interface LobbyUpdateLoadingStart {
  type: '@lobbies/updateLoadingStart'
}

/** The lobby has canceled out of the loading phase (because of timeout or load failure). */
export interface LobbyUpdateLoadingCanceled {
  type: '@lobbies/updateLoadingCanceled'
  payload: {
    /** The users whose failure to load canceled the game, if it's known which ones they were. */
    usersAtFault?: ReadonlyArray<SbUserId>
  }
}

/** A user has changed the race in a lobby we're in. */
export interface LobbyUpdateRaceChange {
  type: '@lobbies/updateRaceChange'
  payload: LobbyRaceChangeEvent
}

/** A user has moved slots in a lobby we're in. */
export interface LobbyUpdateSlotChange {
  type: '@lobbies/updateSlotChange'
  payload: LobbySlotChangeEvent
}

/** A new slot has been created in a lobby we're in (this could indicate a player joining). */
export interface LobbyUpdateSlotCreate {
  type: '@lobbies/updateSlotCreate'
  payload: LobbySlotCreateEvent
}

/** We are beginning to retrieve the lobby preferences from the server. */
export interface GetLobbyPreferencesBegin {
  type: '@lobbies/getPreferencesBegin'
}

/** The server has responded with the current user's saved lobby preferences. */
export interface GetLobbyPreferencesSuccess {
  type: '@lobbies/getPreferences'
  payload: LobbyPreferencesResponse
  error?: false
}

export type GetLobbyPreferencesFailure = BaseFetchFailure<'@lobbies/getPreferences'>

/** We are beginning to save updated lobby preferences to the server. */
export interface UpdateLobbyPreferencesBegin {
  type: '@lobbies/updatePreferencesBegin'
}

/** The server has responded with the lobby preferences as they were saved. */
export interface UpdateLobbyPreferencesSuccess {
  type: '@lobbies/updatePreferences'
  payload: LobbyPreferencesResponse
  error?: false
}

export type UpdateLobbyPreferencesFailure = BaseFetchFailure<'@lobbies/updatePreferences'>
