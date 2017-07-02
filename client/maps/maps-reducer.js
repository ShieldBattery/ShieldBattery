import { List, Map, Record } from 'immutable'
import keyedReducer from '../reducers/keyed-reducer'
import {
  LOBBY_INIT_DATA,
  MAPS_BROWSE_SELECT,
  MAPS_HOST_LOCAL_BEGIN,
  MAPS_HOST_LOCAL,
  MAPS_LIST_GET_BEGIN,
  MAPS_LIST_GET,
  MAPS_SEARCH_BEGIN,
  MAPS_SEARCH,
  MAPS_SEARCH_CLEAR,
} from '../actions'

export const MapRecord = new Record({
  name: null,
  hash: null,
  tileset: null,
  width: -1,
  height: -1,
  description: null,
  format: null,
  imageUrl: null,
  slots: -1,
  umsSlots: -1,
})
export const SearchRecord = new Record({
  list: new List(),
  byHash: new Map(),
  page: -1,
  limit: -1,
  total: -1,

  isSearching: false,
  lastError: null,
})
export const Maps = new Record({
  isFetching: false,
  list: new List(),
  byHash: new Map(),
  lastError: null,
  localMapHash: null,
  localMapPath: null,
  localMapError: null,
  isUploading: false,
  uploadError: null,
  search: new SearchRecord(),
})

export default keyedReducer(new Maps(), {
  [MAPS_LIST_GET_BEGIN](state, action) {
    return state.set('isFetching', true)
  },

  [MAPS_LIST_GET](state, action) {
    if (action.error) {
      return state.set('isFetching', false).set('lastError', action.payload)
    }

    // TODO(tec27): handle pagination
    const list = new List(action.payload.maps.map(m => m.hash))

    const localMap = state.localMapHash ? state.byHash.get(state.localMapHash) : null
    let byHash = new Map(action.payload.maps.map(m => [m.hash, new MapRecord(m)]))
    if (localMap) {
      byHash = byHash.set(state.localMapHash, localMap)
    }
    return state
      .set('isFetching', false)
      .set('byHash', byHash)
      .set('list', list)
      .set('lastError', null)
  },

  [MAPS_BROWSE_SELECT](state, action) {
    if (action.error) {
      return state.set('localMapError', action.payload.message)
    }
    const { map, path } = action.payload
    return (
      state
        .set('localMapHash', map.hash)
        .set('localMapPath', path)
        .set('uploadError', null)
        .set('localMapError', null)
        // Don't overwrite default map list's MapRecords
        .update('byHash', x => x.set(map.hash, x.get(map.hash, new MapRecord(map))))
    )
  },

  [MAPS_HOST_LOCAL_BEGIN](state, action) {
    return state.set('isUploading', true).set('uploadError', null)
  },

  [MAPS_HOST_LOCAL](state, action) {
    if (action.error) {
      return state.set('isUploading', false).set('uploadError', action.payload)
    } else {
      return state.set('isUploading', false)
    }
  },

  [MAPS_SEARCH_BEGIN](state, action) {
    return state.setIn(['search', 'isSearching'], true)
  },

  [MAPS_SEARCH](state, action) {
    if (action.error) {
      return state
        .setIn(['search', 'lastError'], action.payload)
        .setIn(['search', 'isSearching'], false)
    }

    const data = {
      list: new List(action.payload.maps.map(m => m.hash)),
      byHash: new Map(action.payload.maps.map(m => [m.hash, new MapRecord(m)])),
      lastError: null,
      isSearching: false,
    }
    return state.set('search', new SearchRecord(data))
  },

  [MAPS_SEARCH_CLEAR](state, action) {
    return state.set('search', new SearchRecord())
  },

  [LOBBY_INIT_DATA](state, action) {
    return state.set('uploadError', null).set('localMapError', null)
  },
})
