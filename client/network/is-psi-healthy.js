// TODO(tec27): Rename this file and the main function

import logger from '../logging/logger'
import {
  STARCRAFT_DOWNGRADE_BEGIN,
  STARCRAFT_DOWNGRADE,
  STARCRAFT_DOWNGRADE_PATH_USAGE,
  STARCRAFT_PATH_VALIDITY,
  STARCRAFT_VERSION_VALIDITY,
} from '../actions'

const checkStarcraftPath =
  process.webpackEnv.SB_ENV === 'electron'
    ? require('../settings/check-starcraft-path').checkStarcraftPath
    : null
const patchStarcraftDir =
  process.webpackEnv.SB_ENV === 'electron'
    ? require('../settings/patch-starcraft').patchStarcraftDir
    : null

export function hasValidStarcraftPath({ starcraft }) {
  return starcraft.pathValid
}

export function hasValidStarcraftVersion({ starcraft }) {
  return starcraft.versionValid
}

export function isPsiHealthy({ starcraft }) {
  return hasValidStarcraftPath({ starcraft }) && hasValidStarcraftVersion({ starcraft })
}

export function handleCheckStarcraftPathResult(result) {
  return dispatch => {
    dispatch({ type: STARCRAFT_PATH_VALIDITY, payload: result.path })
    dispatch({ type: STARCRAFT_VERSION_VALIDITY, payload: result.version })
    dispatch({ type: STARCRAFT_DOWNGRADE_PATH_USAGE, payload: result.downgradePath })
  }
}

const MIN_TIME_BETWEEN_DOWNGRADES_MS = 60000
export function maybeAttemptDowngrade(starcraftPath, downgradePath) {
  return (dispatch, getState) => {
    const { starcraft: { downgradeInProgress, lastDowngradeAttempt } } = getState()
    if (downgradeInProgress || Date.now() - lastDowngradeAttempt < MIN_TIME_BETWEEN_DOWNGRADES_MS) {
      return
    }

    dispatch(forceAttemptDowngrade(starcraftPath, downgradePath))
  }
}

export function forceAttemptDowngrade(starcraftPath, downgradePath) {
  return dispatch => {
    dispatch({ type: STARCRAFT_DOWNGRADE_BEGIN, payload: { timestamp: Date.now() } })

    const patchPromise = patchStarcraftDir(starcraftPath, downgradePath)
    dispatch({ type: STARCRAFT_DOWNGRADE, payload: patchPromise })

    patchPromise
      .then(() => checkStarcraftPath(starcraftPath, downgradePath))
      .then(result => dispatch(handleCheckStarcraftPathResult(result)))
      .catch(() => {})

    patchPromise.catch(err => {
      if (!err.body || err.body.error !== 'Unrecognized file version') {
        logger.error('Error encountered while attempting to downgrade: ' + err)
      }
    })
  }
}
