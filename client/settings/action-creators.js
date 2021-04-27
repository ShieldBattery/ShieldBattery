import { TypedIpcRenderer } from '../../common/ipc'
import { LOCAL_SETTINGS_SET_BEGIN, SCR_SETTINGS_SET_BEGIN } from '../actions'

const ipcRenderer = new TypedIpcRenderer()

export function mergeLocalSettings(settings) {
  return dispatch => {
    dispatch({
      type: LOCAL_SETTINGS_SET_BEGIN,
    })

    // the ipc-handler will dispatch the right UPDATE event (or SET, if there was an error)
    ipcRenderer.send('settingsLocalMerge', settings)
  }
}

export function mergeScrSettings(settings) {
  return dispatch => {
    dispatch({
      type: SCR_SETTINGS_SET_BEGIN,
    })

    // the ipc-handler will dispatch the right UPDATE event (or SET, if there was an error)
    ipcRenderer.send('settingsScrMerge', settings)
  }
}
