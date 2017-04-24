import { dispatch } from '../dispatch-registry'
import getDowngradePath from '../active-game/get-downgrade-path'
import { handleCheckStarcraftPathResult, maybeAttemptDowngrade } from '../network/is-psi-healthy'
import { LOCAL_SETTINGS_UPDATE, LOCAL_SETTINGS_SET } from '../actions'
import {
} from '../actions'
import {
  SETTINGS_CHANGED,
  SETTINGS_EMIT,
  SETTINGS_EMIT_ERROR,
  SETTINGS_MERGE_ERROR,
} from '../../app/common/ipc-constants'

const { checkStarcraftPath } = process.webpackEnv.SB_ENV === 'electron' ?
    require('./check-starcraft-path') :
    null

export default function registerModule({ ipcRenderer }) {
  if (!ipcRenderer) {
    return
  }

  let lastPath = ''
  let lastPathWasValid = false
  ipcRenderer.on(SETTINGS_CHANGED, (event, settings) => {
    dispatch({
      type: LOCAL_SETTINGS_UPDATE,
      payload: settings
    })

    if (settings.starcraftPath === lastPath && lastPathWasValid) {
      return
    }

    lastPath = settings.starcraftPath
    lastPathWasValid = false
    checkStarcraftPath(settings.starcraftPath, getDowngradePath()).then(result => {
      lastPathWasValid = result.path && result.version
      dispatch(handleCheckStarcraftPathResult(result))

      if (result.path && !result.version) {
        dispatch(maybeAttemptDowngrade(settings.starcraftPath, getDowngradePath()))
      }
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
