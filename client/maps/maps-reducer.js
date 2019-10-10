import { List, Map, Record } from 'immutable'
import keyedReducer from '../reducers/keyed-reducer'
import { MAPS_LIST_CLEAR, MAPS_LIST_GET_BEGIN, MAPS_LIST_GET } from '../actions'

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
export const Maps = new Record({
  list: new List(),
  byHash: new Map(),
  total: -1,

  isRequesting: false,
  lastError: null,
})

export default keyedReducer(new Maps(), {
  [MAPS_LIST_GET_BEGIN](state, action) {
    return state.set('isRequesting', true)
  },

  [MAPS_LIST_GET](state, action) {
    const { maps, total } = action.payload

    if (action.error) {
      return state.set('isRequesting', false).set('lastError', action.payload)
    }

    const list = state.list.concat(maps.filter(m => !state.byHash.has(m.hash)).map(m => m.hash))
    const byHash = state.byHash.merge(maps.map(m => [m.hash, new MapRecord(m)]))

    return state
      .set('list', list)
      .set('byHash', byHash)
      .set('total', total)
      .set('isRequesting', false)
      .set('lastError', null)
  },

  [MAPS_LIST_CLEAR](state, action) {
    return new Maps()
  },
})
