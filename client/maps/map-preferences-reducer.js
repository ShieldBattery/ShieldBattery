import { Record, Set } from 'immutable'
import {
  MAPS_PREFERENCES_GET,
  MAPS_PREFERENCES_GET_BEGIN,
  MAPS_PREFERENCES_UPDATE,
} from '../actions'
import keyedReducer from '../reducers/keyed-reducer'

export const MapPreferences = new Record({
  visibility: null,
  thumbnailSize: null,
  sortOption: null,
  numPlayersFilter: new Set(),
  tilesetFilter: new Set(),

  isRequesting: false,
  // NOTE(2Pac): We don't actually display this anywhere since it's not that useful to the user
  lastError: null,
})

function createPreferences(preferences) {
  return new MapPreferences({
    ...preferences,
    numPlayersFilter: new Set(preferences.numPlayersFilter),
    tilesetFilter: new Set(preferences.tilesetFilter),
    isRequesting: false,
    lastError: null,
  })
}

export default keyedReducer(new MapPreferences(), {
  [MAPS_PREFERENCES_GET_BEGIN](state, action) {
    return new MapPreferences({ isRequesting: true })
  },

  [MAPS_PREFERENCES_GET](state, action) {
    if (action.error) {
      return state.set('isRequesting', false).set('lastError', action.payload)
    }

    return createPreferences(action.payload)
  },

  [MAPS_PREFERENCES_UPDATE](state, action) {
    if (action.error) {
      return state.set('isRequesting', false).set('lastError', action.payload)
    }

    return createPreferences(action.payload)
  },
})
