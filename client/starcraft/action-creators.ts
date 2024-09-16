import { STARCRAFT_PATH_VALIDITY, STARCRAFT_VERSION_VALIDITY } from '../actions.js'
import { ThunkAction } from '../dispatch-registry.js'

export function handleCheckStarcraftPathResult(result: {
  path: boolean
  version: boolean
}): ThunkAction {
  return dispatch => {
    dispatch({ type: STARCRAFT_PATH_VALIDITY, payload: result.path } as any)
    dispatch({ type: STARCRAFT_VERSION_VALIDITY, payload: result.version } as any)
  }
}
