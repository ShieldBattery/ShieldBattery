import { List, Map, Record } from 'immutable'
import {
  ADMIN_MAP_POOL_CLEAR_SEARCH,
  ADMIN_MAP_POOL_CREATE,
  ADMIN_MAP_POOL_DELETE,
  ADMIN_MAP_POOL_GET_HISTORY,
  ADMIN_MAP_POOL_GET_HISTORY_BEGIN,
  ADMIN_MAP_POOL_SEARCH_MAPS,
  ADMIN_MAP_POOL_SEARCH_MAPS_BEGIN,
} from '../actions'
import { MapRecord } from '../maps/maps-reducer'
import keyedReducer from '../reducers/keyed-reducer'

export const MapPool = new Record({
  id: null,
  type: '',
  startDate: null,
  maps: new List(),
})
export const MapPoolHistory = new Record({
  mapPools: new List(),
  byId: new Map(),
  total: -1,

  isRequesting: false,
  lastError: null,
})
export const SearchRecord = new Record({
  list: new List(),
  byId: new Map(),
  total: -1,

  isRequesting: false,
  lastError: null,
})
export const MapPoolsState = new Record({
  types: new Map(),
  searchResult: new SearchRecord(),
})

export default keyedReducer(new MapPoolsState(), {
  [ADMIN_MAP_POOL_GET_HISTORY_BEGIN](state, action) {
    return state.setIn(['types', action.meta.type], new MapPoolHistory({ isRequesting: true }))
  },

  [ADMIN_MAP_POOL_GET_HISTORY](state, action) {
    const { meta, payload } = action

    if (action.error) {
      return state.setIn(['types', meta.type], new MapPoolHistory({ lastError: payload }))
    }

    const history = new MapPoolHistory({
      mapPools: new List(payload.pools.map(p => p.id)),
      byId: new Map(
        payload.pools.map(p => [
          p.id,
          new MapPool({ ...p, maps: new List(p.maps.map(m => new MapRecord(m))) }),
        ]),
      ),
      total: payload.total,
    })
    return state.setIn(['types', meta.type], history)
  },

  [ADMIN_MAP_POOL_SEARCH_MAPS_BEGIN](state, action) {
    return state
      .setIn(['searchResult', 'isRequesting'], true)
      .setIn(['searchResult', 'lastError'], action.payload)
  },

  [ADMIN_MAP_POOL_SEARCH_MAPS](state, action) {
    if (action.error) {
      return state
        .setIn(['searchResult', 'isRequesting'], false)
        .setIn(['searchResult', 'lastError'], action.payload)
    }

    const { maps, total } = action.payload
    const list = state.searchResult.list.concat(maps.map(m => m.id))
    const byId = state.searchResult.byId.merge(maps.map(m => [m.id, new MapRecord(m)]))

    return state.set('searchResult', new SearchRecord({ list, byId, total }))
  },

  [ADMIN_MAP_POOL_CLEAR_SEARCH](state, action) {
    return state.set('searchResult', new SearchRecord())
  },

  [ADMIN_MAP_POOL_CREATE](state, action) {
    const { meta, payload } = action

    if (action.error) {
      return state.setIn(['types', meta.type, 'lastError'], payload)
    }

    const pool = payload
    const history = state.types.get(meta.type)
    const updatedHistory = new MapPoolHistory({
      mapPools: history.mapPools.unshift(pool.id),
      byId: history.byId.set(pool.id, new MapPool({ ...pool, maps: new List(pool.maps) })),
      total: history.total + 1,
    })
    return state.setIn(['types', meta.type], updatedHistory)
  },

  [ADMIN_MAP_POOL_DELETE](state, action) {
    const { meta, payload } = action

    if (action.error) {
      return state.setIn(['types', meta.type, 'lastError'], payload)
    }

    const history = state.types.get(meta.type)
    const removedPoolIndex = history.mapPools.findIndex(p => p === meta.id)

    if (removedPoolIndex < 0) {
      return state
    }

    const updatedHistory = new MapPoolHistory({
      mapPools: history.mapPools.delete(removedPoolIndex),
      byId: history.byId.delete(meta.id),
      total: state.total - 1,
    })
    return state.setIn(['types', meta.type], updatedHistory)
  },
})
