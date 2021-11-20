import createSiteSocketAction from '../action-creators/site-socket-action-creator'
import {
  LOBBIES_GET_STATE,
  LOBBIES_GET_STATE_BEGIN,
  LOBBY_ACTIVATE,
  LOBBY_ADD_COMPUTER,
  LOBBY_ADD_COMPUTER_BEGIN,
  LOBBY_BAN_PLAYER,
  LOBBY_BAN_PLAYER_BEGIN,
  LOBBY_CHANGE_SLOT,
  LOBBY_CHANGE_SLOT_BEGIN,
  LOBBY_CLOSE_SLOT,
  LOBBY_CLOSE_SLOT_BEGIN,
  LOBBY_CREATE,
  LOBBY_CREATE_BEGIN,
  LOBBY_DEACTIVATE,
  LOBBY_JOIN,
  LOBBY_JOIN_BEGIN,
  LOBBY_KICK_PLAYER,
  LOBBY_KICK_PLAYER_BEGIN,
  LOBBY_LEAVE,
  LOBBY_LEAVE_BEGIN,
  LOBBY_MAKE_OBSERVER,
  LOBBY_MAKE_OBSERVER_BEGIN,
  LOBBY_OPEN_SLOT,
  LOBBY_OPEN_SLOT_BEGIN,
  LOBBY_PREFERENCES_GET,
  LOBBY_PREFERENCES_GET_BEGIN,
  LOBBY_PREFERENCES_UPDATE,
  LOBBY_PREFERENCES_UPDATE_BEGIN,
  LOBBY_REMOVE_OBSERVER,
  LOBBY_REMOVE_OBSERVER_BEGIN,
  LOBBY_SEND_CHAT,
  LOBBY_SEND_CHAT_BEGIN,
  LOBBY_SET_RACE,
  LOBBY_SET_RACE_BEGIN,
  LOBBY_START_COUNTDOWN,
  LOBBY_START_COUNTDOWN_BEGIN,
} from '../actions'
import { push } from '../navigation/routing'
import { fetchJson } from '../network/fetch'
import siteSocket from '../network/site-socket'

export const createLobby = (name, map, gameType, gameSubType, allowObservers = true) =>
  createSiteSocketAction(LOBBY_CREATE_BEGIN, LOBBY_CREATE, '/lobbies/create', {
    name,
    map,
    gameType,
    gameSubType,
    allowObservers,
  })

export const joinLobby = name =>
  createSiteSocketAction(LOBBY_JOIN_BEGIN, LOBBY_JOIN, '/lobbies/join', { name })

export const addComputer = slotId =>
  createSiteSocketAction(LOBBY_ADD_COMPUTER_BEGIN, LOBBY_ADD_COMPUTER, '/lobbies/addComputer', {
    slotId,
  })

export const changeSlot = slotId =>
  createSiteSocketAction(LOBBY_CHANGE_SLOT_BEGIN, LOBBY_CHANGE_SLOT, '/lobbies/changeSlot', {
    slotId,
  })

export const setRace = (id, race) =>
  createSiteSocketAction(LOBBY_SET_RACE_BEGIN, LOBBY_SET_RACE, '/lobbies/setRace', { id, race })

export const openSlot = slotId =>
  createSiteSocketAction(LOBBY_OPEN_SLOT_BEGIN, LOBBY_OPEN_SLOT, '/lobbies/openSlot', { slotId })

export const closeSlot = slotId =>
  createSiteSocketAction(LOBBY_CLOSE_SLOT_BEGIN, LOBBY_CLOSE_SLOT, '/lobbies/closeSlot', { slotId })

export const kickPlayer = slotId =>
  createSiteSocketAction(LOBBY_KICK_PLAYER_BEGIN, LOBBY_KICK_PLAYER, '/lobbies/kickPlayer', {
    slotId,
  })

export const banPlayer = slotId =>
  createSiteSocketAction(LOBBY_BAN_PLAYER_BEGIN, LOBBY_BAN_PLAYER, '/lobbies/banPlayer', { slotId })

export const makeObserver = slotId =>
  createSiteSocketAction(LOBBY_MAKE_OBSERVER_BEGIN, LOBBY_MAKE_OBSERVER, '/lobbies/makeObserver', {
    slotId,
  })

export const removeObserver = slotId =>
  createSiteSocketAction(
    LOBBY_REMOVE_OBSERVER_BEGIN,
    LOBBY_REMOVE_OBSERVER,
    '/lobbies/removeObserver',
    { slotId },
  )

export const leaveLobby = () =>
  createSiteSocketAction(LOBBY_LEAVE_BEGIN, LOBBY_LEAVE, '/lobbies/leave')

export const startCountdown = () =>
  createSiteSocketAction(
    LOBBY_START_COUNTDOWN_BEGIN,
    LOBBY_START_COUNTDOWN,
    '/lobbies/startCountdown',
  )

export const sendChat = text =>
  createSiteSocketAction(LOBBY_SEND_CHAT_BEGIN, LOBBY_SEND_CHAT, '/lobbies/sendChat', { text })

const STATE_CACHE_TIMEOUT = 1 * 60 * 1000
export function getLobbyState(lobbyName) {
  return (dispatch, getState) => {
    const { lobbyState } = getState()
    const requestTime = Date.now()
    if (
      lobbyState.has(lobbyName) &&
      requestTime - lobbyState.get(lobbyName).time < STATE_CACHE_TIMEOUT
    ) {
      return
    }

    dispatch({
      type: LOBBIES_GET_STATE_BEGIN,
      payload: { lobbyName },
    })
    dispatch({
      type: LOBBIES_GET_STATE,
      payload: siteSocket.invoke('/lobbies/getLobbyState', { lobbyName }),
      meta: { lobbyName, requestTime },
    })
  }
}

export function getLobbyPreferences() {
  return dispatch => {
    dispatch({ type: LOBBY_PREFERENCES_GET_BEGIN })
    dispatch({
      type: LOBBY_PREFERENCES_GET,
      payload: fetchJson('/api/1/lobbyPreferences'),
    })
  }
}

export function updateLobbyPreferences(preferences) {
  return dispatch => {
    dispatch({ type: LOBBY_PREFERENCES_UPDATE_BEGIN })
    dispatch({
      type: LOBBY_PREFERENCES_UPDATE,
      payload: fetchJson('/api/1/lobbyPreferences', {
        method: 'post',
        body: JSON.stringify(preferences),
      }),
    })
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
  push(`/lobbies/${encodeURIComponent(lobbyName)}`)
}
