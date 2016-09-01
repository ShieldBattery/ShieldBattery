import siteSocket from '../network/site-socket'
import fetch from '../network/fetch'
import { routerActions } from 'react-router-redux'
import {
  LOBBIES_GET_STATE_BEGIN,
  LOBBIES_GET_STATE,
  LOBBY_ACTIVATE,
  LOBBY_DEACTIVATE,
  LOBBY_ADD_COMPUTER_BEGIN,
  LOBBY_ADD_COMPUTER,
  LOBBY_CREATE_BEGIN,
  LOBBY_CREATE,
  LOBBY_JOIN_BEGIN,
  LOBBY_JOIN,
  LOBBY_LEAVE_BEGIN,
  LOBBY_LEAVE,
  LOBBY_SEND_CHAT_BEGIN,
  LOBBY_SEND_CHAT,
  LOBBY_SET_RACE_BEGIN,
  LOBBY_SET_RACE,
  LOBBY_START_COUNTDOWN_BEGIN,
  LOBBY_START_COUNTDOWN,
  MAPS_LIST_GET_BEGIN,
  MAPS_LIST_GET,
} from '../actions'

export function createLobby(name, map, gameType, gameSubType) {
  const params = { name, map, gameType, gameSubType }

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

export function startCountdown() {
  return dispatch => {
    dispatch({
      type: LOBBY_START_COUNTDOWN_BEGIN,
    })

    dispatch({
      type: LOBBY_START_COUNTDOWN,
      payload: siteSocket.invoke('/lobbies/startCountdown')
    })
  }
}

export function sendChat(text) {
  return dispatch => {
    const params = { text }
    dispatch({
      type: LOBBY_SEND_CHAT_BEGIN,
      meta: params,
    })

    dispatch({
      type: LOBBY_SEND_CHAT,
      meta: params,
      payload: siteSocket.invoke('/lobbies/sendChat', params)
    })
  }
}

const STATE_CACHE_TIMEOUT = 1 * 60 * 1000
export function getLobbyState(lobbyName) {
  return (dispatch, getState) => {
    const { lobbyState } = getState()
    const requestTime = Date.now()
    if (lobbyState.has(lobbyName) &&
        (requestTime - lobbyState.get(lobbyName).time) < STATE_CACHE_TIMEOUT) {
      return
    }

    dispatch({
      type: LOBBIES_GET_STATE_BEGIN,
      payload: { lobbyName },
    })
    dispatch({
      type: LOBBIES_GET_STATE,
      payload: siteSocket.invoke('/lobbies/getLobbyState', { lobbyName }),
      meta: { lobbyName, requestTime }
    })
  }
}

export function getMapsList() {
  return (dispatch, getState) => {
    const { maps } = getState()
    if (maps.isFetching || (!maps.lastError && maps.list.size)) {
      return
    }

    dispatch({ type: MAPS_LIST_GET_BEGIN })
    const payload = fetch('/api/1/maps')
    dispatch({ type: MAPS_LIST_GET, payload })
  }
}

export function activateLobby() {
  return {
    type: LOBBY_ACTIVATE,
  }
}

export function deactivateLobby() {
  return {
    type: LOBBY_DEACTIVATE,
  }
}

export function navigateToLobby(lobbyName) {
  return routerActions.push(`/lobbies/${encodeURIComponent(lobbyName)}`)
}
