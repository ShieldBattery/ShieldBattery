import siteSocket from '../network/site-socket'
import {
  LOBBY_CREATE_BEGIN,
  LOBBY_CREATE,
} from '../actions'

export function createLobby(name, map, numSlots) {
  const params = { name, map, numSlots }

  return dispatch => {
    dispatch({
      type: LOBBY_CREATE_BEGIN,
      payload: params
    })

    dispatch({
      type: LOBBY_CREATE,
      payload: siteSocket.invoke('/lobbies/create', params),
      meta: params
    })
  }
}
