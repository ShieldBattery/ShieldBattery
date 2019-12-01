import { List, Map, Record } from 'immutable'
import keyedReducer from '../reducers/keyed-reducer'
import { MAPS_LIST_CLEAR, MAPS_LIST_GET_BEGIN, MAPS_LIST_GET } from '../actions'

export const MapRecord = new Record({
  id: null,
  hash: null,
  name: null,
  description: null,
  uploadedBy: {
    id: null,
    name: null,
  },
  uploadDate: null,
  visibility: null,
  mapData: {
    format: null,
    tileset: null,
    originalName: null,
    originalDescription: null,
    slots: -1,
    umsSlots: -1,
    umsForces: null,
    width: -1,
    height: -1,
  },
  mapUrl: null,
  imageUrl: null,
})
export const Maps = new Record({
  list: new List(),
  byId: new Map(),
  page: 0,
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

    const list = state.list.concat(maps.filter(m => !state.byId.has(m.id)).map(m => m.id))
    const byId = state.byId.merge(maps.map(m => [m.id, new MapRecord(m)]))

    return state
      .set('list', list)
      .set('byId', byId)
      .set('page', state.page + 1)
      .set('total', total)
      .set('isRequesting', false)
      .set('lastError', null)
  },

  [MAPS_LIST_CLEAR](state, action) {
    return new Maps()
  },
})
