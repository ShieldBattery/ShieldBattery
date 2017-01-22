import { dispatch } from '../dispatch-registry'
import { LOCAL_SETTINGS_UPDATE, LOCAL_SETTINGS_SET } from '../actions'
import {
  SETTINGS_CHANGED,
  SETTINGS_EMIT,
  SETTINGS_EMIT_ERROR,
  SETTINGS_MERGE_ERROR,
} from '../../common/ipc-constants'

export default function registerModule({ ipcRenderer }) {
  if (!ipcRenderer) {
    return
  }

  ipcRenderer.on(SETTINGS_CHANGED, (event, settings) => {
    dispatch({
      type: LOCAL_SETTINGS_UPDATE,
      payload: settings
    })
  }).on(SETTINGS_EMIT_ERROR, (event, err) => {
    dispatch({
      type: LOCAL_SETTINGS_UPDATE,
      payload: err,
      error: true,
    })
  }).on(SETTINGS_MERGE_ERROR, (event, err) => {
    dispatch({
      type: LOCAL_SETTINGS_SET,
      payload: err,
      error: true,
    })
  })

  // Trigger an initial update for the settings
  ipcRenderer.send(SETTINGS_EMIT)
}
