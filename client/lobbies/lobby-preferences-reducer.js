import { List, Map, Record } from 'immutable'
import keyedReducer from '../reducers/keyed-reducer'
import { MapRecord } from '../maps/maps-reducer'
import {
  LOBBY_PREFERENCES_GET_BEGIN,
  LOBBY_PREFERENCES_GET,
  LOBBY_PREFERENCES_UPDATE,
} from '../actions'

export const RecentMaps = new Record({
  list: new List(),
  byHash: new Map(),
})
export const LobbyPreferences = new Record({
  name: null,
  gameType: null,
  gameSubType: null,
  recentMaps: new RecentMaps(),
  selectedMap: null,

  isRequesting: false,
  lastError: null,
})

export function recentMapsFromJs(recentMaps) {
  return new RecentMaps({
    list: new List(recentMaps.map(m => m.hash)),
    byHash: new Map(recentMaps.map(m => [m.hash, new MapRecord(m)])),
  })
}

function createPreferences(preferences) {
  return new LobbyPreferences({
    ...preferences,
    recentMaps: recentMapsFromJs(preferences.recentMaps),
    isRequesting: false,
    lastError: null,
  })
}

export default keyedReducer(new LobbyPreferences(), {
  [LOBBY_PREFERENCES_GET_BEGIN](state, action) {
    return state.set('isRequesting', true)
  },

  [LOBBY_PREFERENCES_GET](state, action) {
    if (action.error) {
      return state.set('isRequesting', false).set('lastError', action.payload)
    }

    return createPreferences(action.payload)
  },

  [LOBBY_PREFERENCES_UPDATE](state, action) {
    if (action.error) {
      return state.set('isRequesting', false).set('lastError', action.payload)
    }

    return createPreferences(action.payload)
  },
})
