import psiSocket from '../network/psi-socket'
import {
  RESOLUTION_GET_BEGIN,
  RESOLUTION_GET,
} from '../actions'

export function getResolution() {
  return dispatch => {
    dispatch({
      type: RESOLUTION_GET_BEGIN
    })

    dispatch({
      type: RESOLUTION_GET,
      payload: psiSocket.invoke('/site/getResolution')
    })
  }
}
