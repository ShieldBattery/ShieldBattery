import { dispatch } from '../dispatch-registry'
import getDowngradePath from '../active-game/get-downgrade-path'
import logger from '../logging/logger'
import { LOCAL_SETTINGS_UPDATE, LOCAL_SETTINGS_SET } from '../actions'
import {
  STARCRAFT_DOWNGRADE_BEGIN,
  STARCRAFT_DOWNGRADE,
  STARCRAFT_DOWNGRADE_PATH_USAGE,
  STARCRAFT_PATH_VALIDITY,
  STARCRAFT_VERSION_VALIDITY,
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
const { patchStarcraftDir } = process.webpackEnv.SB_ENV === 'electron' ?
    require('./patch-starcraft') :
    null

const MIN_TIME_BETWEEN_DOWNGRADES_MS = 60000

function maybeAttemptDowngrade(starcraftPath, downgradePath) {
  dispatch((dispatch, getState) => {
    const { starcraft: { downgradeInProgress, lastDowngradeAttempt } } = getState()
    if (downgradeInProgress ||
        (Date.now() - lastDowngradeAttempt) < MIN_TIME_BETWEEN_DOWNGRADES_MS) {
      return
    }

    dispatch({ type: STARCRAFT_DOWNGRADE_BEGIN, payload: { timestamp: Date.now() } })

    const patchPromise = patchStarcraftDir(starcraftPath, downgradePath)
    dispatch({ type: STARCRAFT_DOWNGRADE, payload: patchPromise })

    patchPromise.then(() => checkStarcraftPath(starcraftPath, downgradePath))
      .then(dispatchCheckStarcraftPathResult)
      .catch(() => {})

    patchPromise.catch(err => {
      if (!err.body || err.body.error !== 'Unrecognized file version') {
        logger.error('Error encountered while attempting to downgrade: ' + err)
      }
    })
  })
}

function dispatchCheckStarcraftPathResult(result) {
  dispatch({ type: STARCRAFT_PATH_VALIDITY, payload: result.path })
  dispatch({ type: STARCRAFT_VERSION_VALIDITY, payload: result.version })
  dispatch({ type: STARCRAFT_DOWNGRADE_PATH_USAGE, payload: result.downgradePath })
}

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
      dispatchCheckStarcraftPathResult(result)

      if (result.path && !result.version) {
        maybeAttemptDowngrade(settings.starcraftPath, getDowngradePath())
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
