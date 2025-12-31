import {
  GetMatchmakingSeasonsResponse,
  GetPreferencesResponse,
  MatchmakingSeasonJson,
  MatchmakingStatusJson,
  MatchmakingType,
} from '../../common/matchmaking'
import { GetMatchmakingMapPoolResponse } from '../../common/matchmaking/matchmaking-map-pools'
import { BaseFetchFailure } from '../network/fetch-errors'

export type MatchmakingActions =
  | GetCurrentMapPoolBegin
  | GetCurrentMapPoolSuccess
  | GetCurrentMapPoolFailure
  | InitPreferences
  | UpdatePreferencesSuccess
  | UpdatePreferencesFailure
  | GameStarted
  | MatchmakingStatusUpdate
  | GetMatchmakingSeasons
  | GetCurrentMatchmakingSeason

export interface GetCurrentMapPoolBegin {
  type: '@matchmaking/getCurrentMapPoolBegin'
  payload: {
    type: MatchmakingType
  }
}

export interface GetCurrentMapPoolSuccess {
  type: '@matchmaking/getCurrentMapPool'
  payload: GetMatchmakingMapPoolResponse
  meta: {
    type: MatchmakingType
  }
  error?: false
}

export interface GetCurrentMapPoolFailure extends BaseFetchFailure<'@matchmaking/getCurrentMapPool'> {
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

export interface UpdatePreferencesSuccess {
  type: '@matchmaking/updatePreferences'
  payload: GetPreferencesResponse
  error?: false
  meta: { type: MatchmakingType }
}

export interface UpdatePreferencesFailure extends BaseFetchFailure<'@matchmaking/updatePreferences'> {
  meta: { type: MatchmakingType }
}

export interface GameStarted {
  type: '@matchmaking/gameStarted'
  payload: undefined
}

/** The status (enabled/disabled) of one or more types of matchmaking has changed. */
export interface MatchmakingStatusUpdate {
  type: '@matchmaking/statusUpdate'
  payload: MatchmakingStatusJson[]
}

export interface GetMatchmakingSeasons {
  type: '@matchmaking/getMatchmakingSeasons'
  payload: GetMatchmakingSeasonsResponse
}

export interface GetCurrentMatchmakingSeason {
  type: '@matchmaking/getCurrentMatchmakingSeason'
  payload: MatchmakingSeasonJson
}
