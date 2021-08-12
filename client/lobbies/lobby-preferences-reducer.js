import { List, Map, Record } from 'immutable'
import {
  LOBBY_PREFERENCES_GET,
  LOBBY_PREFERENCES_GET_BEGIN,
  LOBBY_PREFERENCES_UPDATE,
} from '../actions'
import { keyedReducer } from '../reducers/keyed-reducer'

export const RecentMaps = new Record({
  list: new List(),
  byId: new Map(),
})
export const LobbyPreferences = new Record({
  name: null,
  gameType: null,
  gameSubType: null,
  recentMaps: new RecentMaps(),
  selectedMap: null,

  isRequesting: false,
  // NOTE(2Pac): We don't actually display this anywhere since it's not that useful to the user
  lastError: null,
})

export function recentMapsFromJs(recentMaps) {
  return new RecentMaps({
    list: new List(recentMaps.map(m => m.id)),
    byId: new Map(recentMaps.map(m => [m.id, m])),
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
    return new LobbyPreferences({ isRequesting: true })
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
