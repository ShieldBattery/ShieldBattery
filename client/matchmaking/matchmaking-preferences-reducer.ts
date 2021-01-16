import { List, Record } from 'immutable'
import { GetPreferencesPayload, MatchmakingType } from '../../common/matchmaking'
import { RaceChar } from '../../common/races'
import { MapRecord } from '../maps/maps-reducer'
import { FetchError } from '../network/fetch-action-types'
import keyedReducer from '../reducers/keyed-reducer'

export const MatchmakingPreferencesState = Record({
  matchmakingType: MatchmakingType.Match1v1,
  race: 'r' as RaceChar,
  useAlternateRace: false,
  alternateRace: 'z' as RaceChar,
  mapPoolId: null as string | null,
  mapPoolOutdated: false,
  // TODO(tec27): Make this a List<MapRecord> once that is TS-ified
  preferredMaps: List<any>(),

  isRequesting: false,
  lastError: null as FetchError | null,
})

function createPreferencesState(payload: GetPreferencesPayload) {
  return MatchmakingPreferencesState({
    ...payload.preferences,
    mapPoolOutdated: payload.mapPoolOutdated,
    preferredMaps: List(payload.mapInfo.map(m => MapRecord(m))),
  })
}

export default keyedReducer(new MatchmakingPreferencesState(), {
  ['@matchmaking/getPreferencesBegin'](state, action) {
    return new MatchmakingPreferencesState({ isRequesting: true })
  },

  ['@matchmaking/getPreferences'](state, action) {
    if (action.error) {
      return state.set('isRequesting', false).set('lastError', action.payload)
    }

    return createPreferencesState(action.payload)
  },

  ['@matchmaking/updatePreferences'](state, action) {
    if (action.error) {
      return state.set('isRequesting', false).set('lastError', action.payload)
    }

    return createPreferencesState(action.payload)
  },
})
