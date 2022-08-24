import { Immutable } from 'immer'
import {
  GetMatchmakingMapPoolBody,
  GetPreferencesResponse,
  MatchmakingStatusJson,
  MatchmakingType,
  MatchReadyEvent,
} from '../../common/matchmaking'
import { RaceChar } from '../../common/races'
import { BaseFetchFailure } from '../network/fetch-errors'
import { MatchmakingMatch } from './matchmaking-reducer'

export type MatchmakingActions =
  | GetCurrentMapPoolBegin
  | GetCurrentMapPoolSuccess
  | GetCurrentMapPoolFailure
  | InitPreferences
  | UpdatePreferencesBegin
  | UpdatePreferencesSuccess
  | UpdatePreferencesFailure
  | UpdateLastQueuedMatchmakingType
  | CancelMatchBegin
  | CancelMatchSuccess
  | CancelMatchFailure
  | AcceptMatchBegin
  | AcceptMatchSuccess
  | AcceptMatchFailure
  | MatchFound
  | AcceptMatchTime
  | PlayerAccepted
  | PlayerFailedToAccept
  | MatchReady
  | CountdownStarted
  | CountdownTick
  | GameStarting
  | LoadingCanceled
  | GameStarted
  | QueueStatus
  | MatchmakingStatusUpdate
  | StartMatchSearch
  | RequeueSearch

export interface GetCurrentMapPoolBegin {
  type: '@matchmaking/getCurrentMapPoolBegin'
  payload: {
    type: MatchmakingType
  }
}

export interface GetCurrentMapPoolSuccess {
  type: '@matchmaking/getCurrentMapPool'
  payload: GetMatchmakingMapPoolBody
  meta: {
    type: MatchmakingType
  }
  error?: false
}

export interface GetCurrentMapPoolFailure
  extends BaseFetchFailure<'@matchmaking/getCurrentMapPool'> {
  meta: {
    type: MatchmakingType
  }
}

/**
 * Initialize the user's matchmaking preferences when they connect to the application. If they don't
 * have any preferences saved yet, the default values will be used.
 */
export interface InitPreferences {
  type: '@matchmaking/initPreferences'
  payload: GetPreferencesResponse | Record<string, undefined>
  meta: { type: MatchmakingType }
}

export interface UpdatePreferencesBegin {
  type: '@matchmaking/updatePreferencesBegin'
  payload: MatchmakingType
}

export interface UpdatePreferencesSuccess {
  type: '@matchmaking/updatePreferences'
  payload: GetPreferencesResponse
  error?: false
  meta: { type: MatchmakingType }
}

export interface UpdatePreferencesFailure
  extends BaseFetchFailure<'@matchmaking/updatePreferences'> {
  meta: { type: MatchmakingType }
}

/**
 * Update the user's last queued matchmaking type. This matchmaking type will be used when user
 * opens the find-match overlay again. This only does the update on the client; the server will do
 * its own thing where it saves this value on the user's session.
 */
export interface UpdateLastQueuedMatchmakingType {
  type: '@matchmaking/updateLastQueuedMatchmakingType'
  payload: MatchmakingType
}

export interface StartMatchSearch {
  type: '@matchmaking/startSearch'
  payload: {
    matchmakingType: MatchmakingType
    race: RaceChar
  }
  error?: false
}

export interface RequeueSearch {
  type: '@matchmaking/requeue'
  payload: Record<string, never>
  error?: false
}

export interface CancelMatchBegin {
  type: '@matchmaking/cancelMatchBegin'
}

export interface CancelMatchSuccess {
  type: '@matchmaking/cancelMatch'
  payload: void
  error?: false
}

export type CancelMatchFailure = BaseFetchFailure<'@matchmaking/cancelMatch'>

export interface AcceptMatchBegin {
  type: '@matchmaking/acceptMatchBegin'
}

export interface AcceptMatchSuccess {
  type: '@matchmaking/acceptMatch'
  payload: void
  error?: false
}

export type AcceptMatchFailure = BaseFetchFailure<'@matchmaking/acceptMatch'>

export interface MatchFound {
  type: '@matchmaking/matchFound'
  payload: {
    matchmakingType: MatchmakingType
    numPlayers: number
  }
}

export interface AcceptMatchTime {
  type: '@matchmaking/acceptMatchTime'
  payload: number
}

export interface PlayerAccepted {
  type: '@matchmaking/playerAccepted'
  payload: {
    acceptedPlayers: number
  }
}

export interface PlayerFailedToAccept {
  type: '@matchmaking/playerFailedToAccept'
}

export interface MatchReady {
  type: '@matchmaking/matchReady'
  payload: MatchReadyEvent
}

export interface CountdownStarted {
  type: '@matchmaking/countdownStarted'
  payload: number
}

export interface CountdownTick {
  type: '@matchmaking/countdownTick'
  payload: number
}

export interface GameStarting {
  type: '@matchmaking/gameStarting'
}

export interface LoadingCanceled {
  type: '@matchmaking/loadingCanceled'
  payload?: {
    reason: string
  }
}

export interface GameStarted {
  type: '@matchmaking/gameStarted'
  payload: {
    match: Immutable<MatchmakingMatch>
  }
}

export interface QueueStatus {
  type: '@matchmaking/queueStatus'
  payload: {
    matchmaking?: { type: MatchmakingType }
  }
}

/** The status (enabled/disabled) of one or more types of matchmaking has changed. */
export interface MatchmakingStatusUpdate {
  type: '@matchmaking/statusUpdate'
  payload: MatchmakingStatusJson[]
}
