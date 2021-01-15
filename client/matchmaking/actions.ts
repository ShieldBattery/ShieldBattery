import { MatchmakingType } from '../../common/matchmaking'
import { RaceChar } from '../../common/races'
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

// TODO(tec27): Move this to a common place that the server API uses as well
export interface MatchmakingPreferences {
  matchmakingType: MatchmakingType
  race: RaceChar
  useAlternateRace: boolean
  alternateRace: RaceChar
  mapPoolId: string
  preferredMaps: string[]
}

// TODO(tec27): Move this somewhere more common
export interface MapInfo {
  id: string
  hash: string
  name: string
  description: string
  uploadedBy: {
    id: number
    name: string
  }
  uploadDate: string
  visibility: string // TODO(tec27): this is an enum, need to determine values
  mapData: {
    format: string // TODO(tec27): can probably treat this as a string enum
    tileset: string // TODO(tec27): can probably treat this as a string enum
    originalName: string
    originalDescription: string
    slots: number
    umsSlots: number
    // TODO(tec27): type the umsForces/players properly
    umsForces: Array<{ teamId: number; name: string; players: unknown[] }>
    width: number
    height: number
  }
  isFavorited: boolean
  mapUrl: string
  image256Url: string
  image512Url: string
  image1024Url: string
  image2048Url: string
}

export interface GetPreferencesPayload extends Omit<MatchmakingPreferences, 'preferredMaps'> {
  mapPoolOutdated: boolean
  preferredMaps: MapInfo[]
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
