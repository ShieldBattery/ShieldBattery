import psiSocket from '../network/psi-socket'
import {
  LOCAL_SETTINGS_SET_BEGIN,
  LOCAL_SETTINGS_SET,
} from '../actions'

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
