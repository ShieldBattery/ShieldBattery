import { List } from 'immutable'
import { Slot } from '../../common/lobbies/slot'
import { MapInfoJson } from '../../common/maps'
import {
  GetPreferencesPayload,
  MatchmakingMapPool,
  MatchmakingPlayer,
  MatchmakingPreferences,
  MatchmakingType,
} from '../../common/matchmaking'
import { AssignedRaceChar, RaceChar } from '../../common/races'
import { BaseFetchFailure } from '../network/fetch-action-types'
import { MatchmakingMatchRecord } from './matchmaking-reducer'

export type MatchmakingActions =
  | GetCurrentMapPoolBegin
  | GetCurrentMapPoolSuccess
  | GetCurrentMapPoolFailure
  | GetPreferencesBegin
  | GetPreferencesSuccess
  | GetPreferencesFailure
  | UpdatePreferencesBegin
  | UpdatePreferencesSuccess
  | UpdatePreferencesFailure
  | FindMatchBegin
  | FindMatchSuccess
  | FindMatchFailure
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
  | Status

export interface GetCurrentMapPoolBegin {
  type: '@matchmaking/getCurrentMapPoolBegin'
  payload: {
    type: MatchmakingType
  }
}

export interface GetCurrentMapPoolSuccess {
  type: '@matchmaking/getCurrentMapPool'
  payload: MatchmakingMapPool
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

export interface GetPreferencesBegin {
  type: '@matchmaking/getPreferencesBegin'
  payload: { type: MatchmakingType }
}

export interface GetPreferencesSuccess {
  type: '@matchmaking/getPreferences'
  payload: GetPreferencesPayload
  error?: false
  meta: { type: MatchmakingType }
}

export interface GetPreferencesFailure extends BaseFetchFailure<'@matchmaking/getPreferences'> {
  meta: { type: MatchmakingType }
}

export interface UpdatePreferencesBegin {
  type: '@matchmaking/updatePreferencesBegin'
  payload: MatchmakingPreferences
}

export interface UpdatePreferencesSuccess {
  type: '@matchmaking/updatePreferences'
  payload: GetPreferencesPayload
  error?: false
  meta: { type: MatchmakingType }
}

export interface UpdatePreferencesFailure
  extends BaseFetchFailure<'@matchmaking/updatePreferences'> {
  meta: { type: MatchmakingType }
}

export interface FindMatchBegin {
  type: '@matchmaking/findMatchBegin'
  payload: {
    clientId: string
    type: MatchmakingType
    race: RaceChar
    useAlternateRace: boolean
    alternateRace: AssignedRaceChar
    preferredMaps: string[]
  }
}

export interface FindMatchSuccess {
  type: '@matchmaking/findMatch'
  payload: {
    startTime: number
  }
  meta?: {
    clientId: string
    type: MatchmakingType
    race: RaceChar
    useAlternateRace: boolean
    alternateRace: AssignedRaceChar
    preferredMaps: string[]
  }
  error?: false
}

export interface FindMatchFailure extends BaseFetchFailure<'@matchmaking/findMatch'> {
  meta?: {
    clientId: string
    type: MatchmakingType
    race: RaceChar
    useAlternateRace: boolean
    alternateRace: AssignedRaceChar
    preferredMaps: string[]
  }
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
  payload: {
    setup: { gameId: string; seed: number }
    resultCode?: string
    slots: Slot[]
    players: MatchmakingPlayer[]
    mapsByPlayer: { [key: number]: MapInfoJson }
    preferredMaps: MapInfoJson[]
    randomMaps: MapInfoJson[]
    chosenMap: MapInfoJson
  }
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
    match: MatchmakingMatchRecord
  }
}

export interface Status {
  type: '@matchmaking/status'
  payload: {
    matchmaking?: { type: MatchmakingType }
  }
}
