import { List, Map, Record } from 'immutable'
import keyedReducer from '../reducers/keyed-reducer'
import { MAPS_LIST_GET_BEGIN, MAPS_LIST_GET } from '../actions'

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

  isRequesting: false,
  lastError: null,
})

export default keyedReducer(new Maps(), {
  [MAPS_LIST_GET_BEGIN](state, action) {
    return state.set('isRequesting', true)
  },

  [MAPS_LIST_GET](state, action) {
    if (action.error) {
      return state.set('isRequesting', false).set('lastError', action.payload)
    }

    // TODO(tec27): handle pagination
    const list = new List(action.payload.maps.map(m => m.hash))
    const byHash = new Map(action.payload.maps.map(m => [m.hash, new MapRecord(m)]))

    return state
      .set('list', list)
      .set('byHash', byHash)
      .set('isRequesting', false)
      .set('lastError', null)
  },
})
