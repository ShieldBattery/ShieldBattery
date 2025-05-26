import { ThunkAction } from '../dispatch-registry'

export function handleCheckStarcraftPathResult(result: {
  path: boolean
  version: boolean
}): ThunkAction {
  return dispatch => {
    dispatch({ type: '@starcraft/pathValidity', payload: result.path })
    dispatch({ type: '@starcraft/versionValidity', payload: result.version })
  }
}
