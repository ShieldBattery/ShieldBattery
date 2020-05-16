import { dispatch } from '../dispatch-registry'
import getDowngradePath from '../downgrade/get-downgrade-path'
import { handleCheckStarcraftPathResult } from '../starcraft/action-creators'
import { maybeAttemptDowngrade } from '../downgrade/action-creators'
import { LOCAL_SETTINGS_UPDATE, LOCAL_SETTINGS_SET } from '../actions'
import { DOWNGRADE } from '../../common/flags'
import {
  SETTINGS_CHANGED,
  SETTINGS_EMIT,
  SETTINGS_EMIT_ERROR,
  SETTINGS_MERGE_ERROR,
} from '../../common/ipc-constants'

const checkStarcraftPath = IS_ELECTRON
  ? require('../starcraft/check-starcraft-path').checkStarcraftPath
  : null

export default function registerModule({ ipcRenderer }) {
  if (!ipcRenderer) {
    return
  }

  let lastPath = ''
  let lastPathWasValid = false
  ipcRenderer
    .on(SETTINGS_CHANGED, (event, settings) => {
      dispatch({
        type: LOCAL_SETTINGS_UPDATE,
        payload: settings,
      })

      if (settings.starcraftPath === lastPath && lastPathWasValid) {
        return
      }

      lastPath = settings.starcraftPath
      lastPathWasValid = false
      checkStarcraftPath(settings.starcraftPath).then(result => {
        lastPathWasValid = result.path && result.version
        dispatch(handleCheckStarcraftPathResult(result))

        if (DOWNGRADE && result.path && !result.version) {
          dispatch(maybeAttemptDowngrade(settings.starcraftPath, getDowngradePath()))
        }
      })
    })
    .on(SETTINGS_EMIT_ERROR, (event, err) => {
      dispatch({
        type: LOCAL_SETTINGS_UPDATE,
        payload: err,
        error: true,
      })
    })
    .on(SETTINGS_MERGE_ERROR, (event, err) => {
      dispatch({
        type: LOCAL_SETTINGS_SET,
        payload: err,
        error: true,
      })
    })

  // Trigger an initial update for the settings
  ipcRenderer.send(SETTINGS_EMIT)
}
