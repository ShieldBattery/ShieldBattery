import { REGISTER_FOR_SERVER_STATUS, UNREGISTER_FOR_SERVER_STATUS, SERVER_STATUS } from '../actions'
import siteSocket from '../network/site-socket'
import * as registry from '../dispatch-registry'

function onEvent(event) {
  registry.dispatch({ type: SERVER_STATUS, payload: event })
}

function subscribe(dispatch) {
  siteSocket.subscribe('/status', onEvent, err => {
    if (err) dispatch({ type: SERVER_STATUS, error: true, payload: { err } })
  })
}

function unsubscribe(dispatch) {
  // TODO(tec27): I don't think this check actually makes sense
  if (!siteSocket.connected) return

  siteSocket.unsubscribe('/status', onEvent)
}

export function register() {
  return (dispatch, getState) => {
    const registered = getState().serverStatus.get('registered')
    dispatch({ type: REGISTER_FOR_SERVER_STATUS })

    if (!registered) {
      subscribe(dispatch)
    }
  }
}

export function unregister() {
  return (dispatch, getState) => {
    const registered = getState().serverStatus.get('registered')
    dispatch({ type: UNREGISTER_FOR_SERVER_STATUS })

    if (registered) {
      unsubscribe(dispatch)
    }
  }
}
