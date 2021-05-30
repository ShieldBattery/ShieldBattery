import { Record } from 'immutable'
import {
  UPDATER_NEW_VERSION_DOWNLOADED,
  UPDATER_NEW_VERSION_FOUND,
  UPDATER_UP_TO_DATE,
} from '../actions'
import { keyedReducer } from '../reducers/keyed-reducer'

export const UpdateStatus = new Record({
  hasUpdate: false,
  hasDownloadError: false,
  readyToInstall: false,
})

export default keyedReducer(new UpdateStatus(), {
  [UPDATER_NEW_VERSION_FOUND](state, action) {
    return state.merge({
      hasUpdate: true,
      hasDownloadError: false,
      readyToInstall: false,
    })
  },

  [UPDATER_NEW_VERSION_DOWNLOADED](state, action) {
    return state.merge({
      hasDownloadError: action.error,
      readyToInstall: !action.error,
    })
  },

  [UPDATER_UP_TO_DATE](state, action) {
    return state.merge({
      hasUpdate: false,
      hasDownloadError: false,
      readyToInstall: false,
    })
  },
})
