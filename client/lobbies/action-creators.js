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
  LOBBY_BAN_PLAYER_BEGIN,
  LOBBY_BAN_PLAYER,
  LOBBY_CHANGE_SLOT_BEGIN,
  LOBBY_CHANGE_SLOT,
  LOBBY_CLOSE_SLOT_BEGIN,
  LOBBY_CLOSE_SLOT,
  LOBBY_CREATE_BEGIN,
  LOBBY_CREATE,
  LOBBY_JOIN_BEGIN,
  LOBBY_JOIN,
  LOBBY_KICK_PLAYER_BEGIN,
  LOBBY_KICK_PLAYER,
  LOBBY_LEAVE_BEGIN,
  LOBBY_LEAVE,
  LOBBY_OPEN_SLOT_BEGIN,
  LOBBY_OPEN_SLOT,
  LOBBY_REMOVE_COMPUTER_BEGIN,
  LOBBY_REMOVE_COMPUTER,
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

export function addComputer(slotId) {
  const params = { slotId }

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

export function removeComputer(slotId) {
  const params = { slotId }

  return dispatch => {
    dispatch({
      type: LOBBY_REMOVE_COMPUTER_BEGIN,
      payload: params
    })

    dispatch({
      type: LOBBY_REMOVE_COMPUTER,
      payload: siteSocket.invoke('/lobbies/removeComputer', params),
      meta: params
    })
  }
}

export function changeSlot(slotId) {
  const params = { slotId }
  return dispatch => {
    dispatch({
      type: LOBBY_CHANGE_SLOT_BEGIN,
      payload: params
    })
    dispatch({
      type: LOBBY_CHANGE_SLOT,
      payload: siteSocket.invoke('/lobbies/changeSlot', params),
      meta: params,
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

export function openSlot(slotId) {
  const params = { slotId }
  return dispatch => {
    dispatch({
      type: LOBBY_OPEN_SLOT_BEGIN,
      payload: params
    })
    dispatch({
      type: LOBBY_OPEN_SLOT,
      payload: siteSocket.invoke('/lobbies/openSlot', params),
      meta: params,
    })
  }
}

export function closeSlot(slotId) {
  const params = { slotId }
  return dispatch => {
    dispatch({
      type: LOBBY_CLOSE_SLOT_BEGIN,
      payload: params
    })
    dispatch({
      type: LOBBY_CLOSE_SLOT,
      payload: siteSocket.invoke('/lobbies/closeSlot', params),
      meta: params,
    })
  }
}

export function kickPlayer(slotId) {
  const params = { slotId }
  return dispatch => {
    dispatch({
      type: LOBBY_KICK_PLAYER_BEGIN,
      payload: params
    })
    dispatch({
      type: LOBBY_KICK_PLAYER,
      payload: siteSocket.invoke('/lobbies/kickPlayer', params),
      meta: params,
    })
  }
}

export function banPlayer(slotId) {
  const params = { slotId }
  return dispatch => {
    dispatch({
      type: LOBBY_BAN_PLAYER_BEGIN,
      payload: params
    })
    dispatch({
      type: LOBBY_BAN_PLAYER,
      payload: siteSocket.invoke('/lobbies/banPlayer', params),
      meta: params,
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
