import { dispatch } from '../dispatch-registry'
import { LOCAL_SETTINGS_UPDATE, LOCAL_SETTINGS_SET } from '../actions'
import {
  STARCRAFT_PATH_VALIDITY,
  STARCRAFT_VERSION_VALIDITY,
} from '../actions'
import {
  SETTINGS_CHANGED,
  SETTINGS_EMIT,
  SETTINGS_EMIT_ERROR,
  SETTINGS_MERGE_ERROR,
} from '../../common/ipc-constants'

const checkStarcraftPath = process.webpackEnv.SB_ENV === 'electron' ?
    require('./check-starcraft-path').checkStarcraftPath :
    null

export default function registerModule({ ipcRenderer }) {
  if (!ipcRenderer) {
    return
  }

  let lastPath = ''
  ipcRenderer.on(SETTINGS_CHANGED, (event, settings) => {
    dispatch({
      type: LOCAL_SETTINGS_UPDATE,
      payload: settings
    })

    if (settings.starcraftPath === lastPath) {
      return
    }

    lastPath = settings.starcraftPath
    checkStarcraftPath(settings.starcraftPath).then(result => {
      dispatch({ type: STARCRAFT_PATH_VALIDITY, payload: result.path })
      dispatch({ type: STARCRAFT_VERSION_VALIDITY, payload: result.version })
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
