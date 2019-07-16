import { Record } from 'immutable'
import keyedReducer from '../reducers/keyed-reducer'
import { ACTIVITY_OVERLAY_CLOSE, LOCAL_MAPS_UPLOAD_BEGIN, LOCAL_MAPS_UPLOAD } from '../actions'

export const LocalMaps = new Record({
  isUploading: false,
  lastError: null,
})

export default keyedReducer(new LocalMaps(), {
  [LOCAL_MAPS_UPLOAD_BEGIN](state, action) {
    return state.set('isUploading', true)
  },

  [LOCAL_MAPS_UPLOAD](state, action) {
    if (action.error) {
      return state.set('isUploading', false).set('uploadError', action.payload)
    }

    return state.set('isUploading', false).set('uploadError', null)
  },

  [ACTIVITY_OVERLAY_CLOSE](state, action) {
    return action.meta.overlayType === 'browseLocalMaps' ? new LocalMaps() : state
  },
})
