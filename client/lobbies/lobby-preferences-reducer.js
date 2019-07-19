import { List, Map, Record } from 'immutable'
import keyedReducer from '../reducers/keyed-reducer'
import { MapRecord } from '../maps/maps-reducer'
import {
  LOBBY_PREFERENCES_GET_BEGIN,
  LOBBY_PREFERENCES_GET,
  LOBBY_PREFERENCES_UPDATE,
  LOCAL_MAPS_UPLOAD,
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

  lastUpdated: 0,
  isRequesting: false,
  lastError: null,
})

function createPreferences(preferences) {
  const recentMaps = new RecentMaps({
    list: new List(preferences.recentMaps.map(m => m.hash)),
    byHash: new Map(preferences.recentMaps.map(m => [m.hash, new MapRecord(m)])),
  })

  return new LobbyPreferences({
    ...preferences,
    recentMaps,
    lastUpdated: Date.now(),
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

  [LOCAL_MAPS_UPLOAD](state, action) {
    const recentMaps = new RecentMaps({
      list: state.recentMaps.list.pop().insert(0, action.payload),
      byHash: state.recentMaps.byHash.set(action.payload.hash, action.payload),
    })

    return state.set('recentMaps', recentMaps).set('selectedMap', action.payload.hash)
  },
})
