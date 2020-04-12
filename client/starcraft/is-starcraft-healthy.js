import { STARCRAFT_PATH_VALIDITY, STARCRAFT_VERSION_VALIDITY } from '../actions'

export function hasValidStarcraftPath({ starcraft }) {
  return starcraft.pathValid
}

export function hasValidStarcraftVersion({ starcraft }) {
  return starcraft.versionValid
}

export function isStarcraftHealthy({ starcraft }) {
  return hasValidStarcraftPath({ starcraft }) && hasValidStarcraftVersion({ starcraft })
}

export function handleCheckStarcraftPathResult(result) {
  return dispatch => {
    dispatch({ type: STARCRAFT_PATH_VALIDITY, payload: result.path })
    dispatch({ type: STARCRAFT_VERSION_VALIDITY, payload: result.version })
  }
}
