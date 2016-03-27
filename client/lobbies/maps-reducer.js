import { List, Map, Record } from 'immutable'
import {
  MAPS_LIST_GET_BEGIN,
  MAPS_LIST_GET,
} from '../actions'

export const MapRecord = new Record({
  name: null,
  hash: null,
  tileset: null,
  width: -1,
  height: -1,
  description: null,
  format: null,
  thumbFormat: null,
  slots: -1,
  umsSlots: -1,
})
export const Maps = new Record({
  isFetching: false,
  list: new List(),
  byHash: new Map(),
  lastError: null,
})

const handlers = {
  [MAPS_LIST_GET_BEGIN](state, action) {
    return state.set('isFetching', true)
  },

  [MAPS_LIST_GET](state, action) {
    if (action.error) {
      return state.set('isFetching', false).set('lastError', action.payload)
    }

    // TODO(tec27): handle pagination
    const list = new List(action.payload.maps.map(m => m.hash))
    const byHash = new Map(action.payload.maps.map(m => [ m.hash, new MapRecord(m) ]))
    return (state.set('isFetching', false)
      .set('byHash', byHash)
      .set('list', list)
      .set('lastError', null))
  }
}

export default function mapsReducer(state = new Maps(), action) {
  return handlers.hasOwnProperty(action.type) ? handlers[action.type](state, action) : state
}
