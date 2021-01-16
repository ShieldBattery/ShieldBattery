import {
  GetPreferencesPayload,
  MatchmakingPreferences,
  MatchmakingType,
} from '../../common/matchmaking'
import { BaseFetchFailure } from '../network/fetch-action-types'

export type MatchmakingActions =
  | GetPreferencesBegin
  | GetPreferencesSuccess
  | GetPreferencesFailure
  | UpdatePreferencesBegin
  | UpdatePreferencesSuccess
  | UpdatePreferencesFailure

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
