import { Record } from 'immutable'
import keyedReducer from '../reducers/keyed-reducer'
import { MAPS_DETAILS_GET_BEGIN, MAPS_DETAILS_GET, MAPS_UPDATE } from '../actions'

export const MapDetails = new Record({
  map: null,

  isRequesting: false,
  lastError: null,
})

export default keyedReducer(new MapDetails(), {
  [MAPS_DETAILS_GET_BEGIN](state, action) {
    return state.set('isRequesting', true).set('lastError', null)
  },

  [MAPS_DETAILS_GET](state, action) {
    if (action.error) {
      return state.set('isRequesting', false).set('lastError', action.payload)
    }

    return state.set('map', action.payload.map).set('isRequesting', false).set('lastError', null)
  },

  [MAPS_UPDATE](state, action) {
    if (action.error) {
      // TODO(2Pac): Show the error to the user somehow?
      return state
    }

    return state.set('map', action.payload.map)
  },
})
