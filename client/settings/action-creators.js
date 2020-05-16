import { LOCAL_SETTINGS_SET_BEGIN } from '../actions'
import { SETTINGS_MERGE } from '../../common/ipc-constants'

const ipcRenderer = IS_ELECTRON ? require('electron').ipcRenderer : null

export function mergeLocalSettings(settings) {
  if (!ipcRenderer) {
    throw new Error('This function should not be called outside of an Electron environment')
  }

  const params = { settings }

  return dispatch => {
    dispatch({
      type: LOCAL_SETTINGS_SET_BEGIN,
      payload: params,
    })

    // the ipc-handler will dispatch the right UPDATE event (or SET, if there was an error)
    ipcRenderer.send(SETTINGS_MERGE, settings)
  }
}
