import logger from '../logging/logger'
import { handleCheckStarcraftPathResult } from '../starcraft/is-starcraft-healthy'
import { STARCRAFT_DOWNGRADE_BEGIN, STARCRAFT_DOWNGRADE } from '../actions'

const checkStarcraftPath = IS_ELECTRON
  ? require('../starcraft/check-starcraft-path').checkStarcraftPath
  : null
const patchStarcraftDir = IS_ELECTRON ? require('./patch-starcraft').patchStarcraftDir : null

const MIN_TIME_BETWEEN_DOWNGRADES_MS = 60000
export function maybeAttemptDowngrade(starcraftPath, downgradePath) {
  return (dispatch, getState) => {
    const {
      downgrade: { downgradeInProgress, lastDowngradeAttempt },
    } = getState()
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
