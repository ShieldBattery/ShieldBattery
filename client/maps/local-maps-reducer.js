import { Record } from 'immutable'
import keyedReducer from '../reducers/keyed-reducer'
import { ACTIVITY_OVERLAY_CLOSE, LOCAL_MAPS_SELECT_BEGIN, LOCAL_MAPS_SELECT } from '../actions'

export const LocalMaps = new Record({
  selectedMap: null,
  isUploading: false,
  lastError: null,
})

export default keyedReducer(new LocalMaps(), {
  [LOCAL_MAPS_SELECT_BEGIN](state, action) {
    return state.set('isUploading', true)
  },

  [LOCAL_MAPS_SELECT](state, action) {
    if (action.error) {
      return state.set('isUploading', false).set('lastError', action.payload)
    }

    return state
      .set('selectedMap', action.payload.map)
      .set('isUploading', false)
      .set('lastError', null)
  },

  [ACTIVITY_OVERLAY_CLOSE](state, action) {
    return action.meta.overlayType === 'browseLocalMaps' ? new LocalMaps() : state
  },
})
