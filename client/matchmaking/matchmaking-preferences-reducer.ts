import { List, Record } from 'immutable'
import keyedReducer from '../reducers/keyed-reducer'
import { MapRecord } from '../maps/maps-reducer'
import { MatchmakingType } from '../../common/matchmaking'
import { RaceChar } from '../../common/races'
import { GetPreferencesPayload, MapInfo } from './actions'
import { FetchError } from '../network/fetch-action-types'

export const MatchmakingPreferencesState = Record({
  matchmakingType: MatchmakingType.Match1v1,
  race: 'r' as RaceChar,
  useAlternateRace: false,
  alternateRace: 'z' as RaceChar,
  mapPoolId: null as string | null,
  mapPoolOutdated: false,
  preferredMaps: List<MapInfo>(),

  isRequesting: false,
  lastError: null as FetchError | null,
})

function createPreferences(preferences: GetPreferencesPayload) {
  const data = {
    ...preferences,
    preferredMaps: List(preferences.preferredMaps.map(m => new MapRecord(m))),
  }
  return new MatchmakingPreferencesState(data)
}

export default keyedReducer(new MatchmakingPreferencesState(), {
  ['@matchmaking/getPreferencesBegin'](state, action) {
    return new MatchmakingPreferencesState({ isRequesting: true })
  },

  ['@matchmaking/getPreferences'](state, action) {
    if (action.error) {
      return state.set('isRequesting', false).set('lastError', action.payload)
    }

    return createPreferences(action.payload)
  },

  ['@matchmaking/updatePreferences'](state, action) {
    if (action.error) {
      return state.set('isRequesting', false).set('lastError', action.payload)
    }

    return createPreferences(action.payload)
  },
})
