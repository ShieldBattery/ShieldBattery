import { Record } from 'immutable'
import keyedReducer from '../reducers/keyed-reducer'
import { LOCAL_MAPS_SELECT_BEGIN, LOCAL_MAPS_SELECT } from '../actions'

export const LocalMaps = new Record({
  isUploading: false,
  lastError: null,
})

export default keyedReducer(new LocalMaps(), {
  [LOCAL_MAPS_SELECT_BEGIN](state, action) {
    return state.set('isUploading', true).set('lastError', null)
  },

  [LOCAL_MAPS_SELECT](state, action) {
    if (action.error) {
      return state.set('isUploading', false).set('lastError', action.payload)
    }

    return state.set('isUploading', false).set('lastError', null)
  },
})
