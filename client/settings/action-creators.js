import psiSocket from '../network/psi-socket'
import {
  LOCAL_SETTINGS_SET_BEGIN,
  LOCAL_SETTINGS_SET,
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

export function setLocalSettings(settings) {
  const params = { settings }

  return dispatch => {
    dispatch({
      type: LOCAL_SETTINGS_SET_BEGIN,
      payload: params
    })

    dispatch({
      type: LOCAL_SETTINGS_SET,
      payload: psiSocket.invoke('/site/settings/set', params),
      meta: params
    })
  }
}
