import siteSocket from '../network/site-socket'
import {
  LOBBY_ADD_COMPUTER_BEGIN,
  LOBBY_ADD_COMPUTER,
  LOBBY_CREATE_BEGIN,
  LOBBY_CREATE,
  LOBBY_JOIN_BEGIN,
  LOBBY_JOIN,
  LOBBY_LEAVE_BEGIN,
  LOBBY_LEAVE,
  LOBBY_SET_RACE_BEGIN,
  LOBBY_SET_RACE,
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

export function joinLobby(name) {
  const params = { name }

  return dispatch => {
    dispatch({
      type: LOBBY_JOIN_BEGIN,
      payload: params
    })

    dispatch({
      type: LOBBY_JOIN,
      payload: siteSocket.invoke('/lobbies/join', params),
      meta: params
    })
  }
}

export function addComputer(slotNum) {
  const params = { slotNum }

  return dispatch => {
    dispatch({
      type: LOBBY_ADD_COMPUTER_BEGIN,
      payload: params
    })

    dispatch({
      type: LOBBY_ADD_COMPUTER,
      payload: siteSocket.invoke('/lobbies/addComputer', params),
      meta: params
    })
  }
}

export function setRace(id, race) {
  const params = { id, race }

  return dispatch => {
    dispatch({
      type: LOBBY_SET_RACE_BEGIN,
      payload: params
    })

    dispatch({
      type: LOBBY_SET_RACE,
      payload: siteSocket.invoke('/lobbies/setRace', params),
      meta: params
    })
  }
}

export function leaveLobby() {
  return dispatch => {
    dispatch({
      type: LOBBY_LEAVE_BEGIN,
    })

    dispatch({
      type: LOBBY_LEAVE,
      payload: siteSocket.invoke('/lobbies/leave')
    })
  }
}
