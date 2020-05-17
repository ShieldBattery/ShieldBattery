import { List, Record } from 'immutable'
import keyedReducer from '../reducers/keyed-reducer'
import { MapRecord } from '../maps/maps-reducer'
import {
  MATCHMAKING_PREFERENCES_GET_BEGIN,
  MATCHMAKING_PREFERENCES_GET,
  MATCHMAKING_PREFERENCES_UPDATE,
} from '../actions'

export const MatchmakingPreferences = new Record({
  matchmakingType: null,
  race: null,
  useAlternateRace: null,
  alternateRace: null,
  mapPoolId: null,
  mapPoolOutdated: false,
  preferredMaps: new List(),

  isRequesting: false,
  // NOTE(2Pac): We don't actually display this anywhere since it's not that useful to the user
  lastError: null,
})

function createPreferences(preferences) {
  const data = {
    ...preferences,
    preferredMaps: new List(preferences.preferredMaps.map(m => new MapRecord(m))),
  }
  return new MatchmakingPreferences(data)
}

export default keyedReducer(new MatchmakingPreferences(), {
  [MATCHMAKING_PREFERENCES_GET_BEGIN](state, action) {
    return new MatchmakingPreferences({ isRequesting: true })
  },

  [MATCHMAKING_PREFERENCES_GET](state, action) {
    if (action.error) {
      return state.set('isRequesting', false).set('lastError', action.payload)
    }

    return createPreferences(action.payload)
  },

  [MATCHMAKING_PREFERENCES_UPDATE](state, action) {
    if (action.error) {
      return state.set('isRequesting', false).set('lastError', action.payload)
    }

    return createPreferences(action.payload)
  },
})
