import { LOCAL_SETTINGS_SET_BEGIN, SCR_SETTINGS_SET_BEGIN } from '../actions'
import { LOCAL_SETTINGS_MERGE, SCR_SETTINGS_MERGE } from '../../common/ipc-constants'
import { fromSbToScr } from './settings-records'

const ipcRenderer = IS_ELECTRON ? require('electron').ipcRenderer : null

export function mergeLocalSettings(settings) {
  if (!ipcRenderer) {
    throw new Error('This function should not be called outside of an Electron environment')
  }

  return dispatch => {
    dispatch({
      type: LOCAL_SETTINGS_SET_BEGIN,
    })

    // the ipc-handler will dispatch the right UPDATE event (or SET, if there was an error)
    ipcRenderer.send(LOCAL_SETTINGS_MERGE, settings)
  }
}

export function mergeScrSettings(settings) {
  if (!ipcRenderer) {
    throw new Error('This function should not be called outside of an Electron environment')
  }

  return dispatch => {
    dispatch({
      type: SCR_SETTINGS_SET_BEGIN,
    })

    // the ipc-handler will dispatch the right UPDATE event (or SET, if there was an error)
    ipcRenderer.send(SCR_SETTINGS_MERGE, fromSbToScr(settings))
  }
}
