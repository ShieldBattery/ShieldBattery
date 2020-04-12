import {
  STARCRAFT_PATH_VALIDITY,
  STARCRAFT_VERSION_VALIDITY,
  STARCRAFT_REMASTERED_STATUS,
} from '../actions'

export function handleCheckStarcraftPathResult(result) {
  return dispatch => {
    dispatch({ type: STARCRAFT_PATH_VALIDITY, payload: result.path })
    dispatch({ type: STARCRAFT_VERSION_VALIDITY, payload: result.version })
    dispatch({ type: STARCRAFT_REMASTERED_STATUS, payload: result.remastered })
  }
}
