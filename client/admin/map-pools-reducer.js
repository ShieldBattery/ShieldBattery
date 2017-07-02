import { List, Map, Record } from 'immutable'
import keyedReducer from '../reducers/keyed-reducer'
import {
  ADMIN_GET_MAP_POOL_HISTORY_BEGIN,
  ADMIN_GET_MAP_POOL_HISTORY,
  ADMIN_CREATE_MAP_POOL,
  ADMIN_DELETE_MAP_POOL,
} from '../actions'

export const MapPool = new Record({
  id: null,
  type: '',
  startDate: null,
  maps: new List(),
})
export const MapPoolHistory = new Record({
  mapPools: new Map(),

  isRequesting: false,
  lastError: null,
})
export const MapPoolsState = new Record({
  types: new Map(),
})

export default keyedReducer(new MapPoolsState(), {
  [ADMIN_GET_MAP_POOL_HISTORY_BEGIN](state, action) {
    return state.updateIn(['types', action.payload.type], new MapPoolHistory(), m =>
      m.set('isRequesting', true),
    )
  },

  [ADMIN_GET_MAP_POOL_HISTORY](state, action) {
    if (action.error) {
      const data = {
        lastError: action.payload,
        isRequesting: false,
      }
      return state.updateIn(['types', action.meta.type], new MapPoolHistory(), m => m.merge(data))
    }

    const { pools, type } = action.payload
    const data = {
      mapPools: new Map(
        pools.map(mapPool => [
          mapPool.id,
          new MapPool({
            ...mapPool,
            maps: new List(mapPool.maps.filter(m => !!m)),
          }),
        ]),
      ),
      lastError: null,
      isRequesting: false,
    }
    return state
      .updateIn(['types', type], new MapPoolHistory(), m => m.merge(data))
      .updateIn(['types', type, 'mapPools'], m => m.sort((a, b) => b.startDate - a.startDate))
  },

  [ADMIN_CREATE_MAP_POOL](state, action) {
    if (action.error) {
      return state.setIn(['types', action.meta.type, 'lastError'], action.payload)
    }

    const { type, id, maps } = action.payload
    return state
      .setIn(['types', type, 'lastError'], null)
      .updateIn(['types', type, 'mapPools'], new MapPool(), m =>
        m.set(
          id,
          new MapPool({
            ...action.payload,
            maps: new List(maps.filter(m => !!m)),
          }),
        ),
      )
      .updateIn(['types', type, 'mapPools'], m => m.sort((a, b) => b.startDate - a.startDate))
  },

  [ADMIN_DELETE_MAP_POOL](state, action) {
    const { type, id } = action.meta
    if (action.error) {
      return state.setIn(['types', type, 'lastError'], action.payload)
    }

    return state
      .setIn(['types', type, 'lastError'], null)
      .updateIn(['types', type, 'mapPools'], new MapPool(), m => m.delete(id))
  },
})
