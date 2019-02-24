import siteSocket from '../network/site-socket'
import { push } from 'connected-react-router'
import {
  WHISPERS_CLOSE_SESSION_BEGIN,
  WHISPERS_CLOSE_SESSION,
  WHISPERS_LOAD_SESSION_HISTORY_BEGIN,
  WHISPERS_LOAD_SESSION_HISTORY,
  WHISPERS_SESSION_ACTIVATE,
  WHISPERS_SESSION_DEACTIVATE,
  WHISPERS_SEND_MESSAGE_BEGIN,
  WHISPERS_SEND_MESSAGE,
  WHISPERS_START_SESSION_BEGIN,
  WHISPERS_START_SESSION,
} from '../actions'

export function startWhisperSession(target) {
  return dispatch => {
    const params = { target }
    dispatch({
      type: WHISPERS_START_SESSION_BEGIN,
      payload: params,
    })
    dispatch({
      type: WHISPERS_START_SESSION,
      payload: siteSocket.invoke('/whispers/start', params),
      meta: params,
    })
  }
}

export function closeWhisperSession(target) {
  return dispatch => {
    const params = { target }
    dispatch({
      type: WHISPERS_CLOSE_SESSION_BEGIN,
      payload: params,
    })
    dispatch({
      type: WHISPERS_CLOSE_SESSION,
      payload: siteSocket.invoke('/whispers/close', params),
      meta: params,
    })
  }
}

export function sendMessage(target, message) {
  return dispatch => {
    const params = { target, message }
    dispatch({
      type: WHISPERS_SEND_MESSAGE_BEGIN,
      payload: params,
    })
    dispatch({
      type: WHISPERS_SEND_MESSAGE,
      payload: siteSocket.invoke('/whispers/send', params),
      meta: params,
    })
  }
}

// Retrieves the "initial" message history for a whisper session, that is, what we retrieve whenever
// a user views a whisper session at all. This will only retrieve one batch of history ever, if more
// is desired, use `retrieveNextMessageHistory`.
export function retrieveInitialMessageHistory(target) {
  return (dispatch, getStore) => {
    const {
      whispers: { byName },
    } = getStore()
    if (!byName.has(target)) {
      return
    }

    const sessionData = byName.get(target)
    if (sessionData.hasLoadedHistory || sessionData.loadingHistory || !sessionData.hasHistory) {
      return
    }
    const params = { target }

    dispatch({
      type: WHISPERS_LOAD_SESSION_HISTORY_BEGIN,
      payload: params,
    })
    dispatch({
      type: WHISPERS_LOAD_SESSION_HISTORY,
      payload: siteSocket.invoke('/whispers/getHistory', params),
      meta: params,
    })
  }
}

export function retrieveNextMessageHistory(target) {
  return (dispatch, getStore) => {
    const {
      whispers: { byName },
    } = getStore()
    if (!byName.has(target)) {
      return
    }

    const sessionData = byName.get(target)
    if (sessionData.loadingHistory || !sessionData.hasHistory) {
      return
    }
    const earliestMessageTime = sessionData.hasLoadedHistory ? sessionData.messages.get(0).time : -1
    const params = { target, beforeTime: earliestMessageTime }

    dispatch({
      type: WHISPERS_LOAD_SESSION_HISTORY_BEGIN,
      payload: params,
    })
    dispatch({
      type: WHISPERS_LOAD_SESSION_HISTORY,
      payload: siteSocket.invoke('/whispers/getHistory', params),
      meta: params,
    })
  }
}

export function activateWhisperSession(target) {
  return {
    type: WHISPERS_SESSION_ACTIVATE,
    payload: { target },
  }
}

export function deactivateWhisperSession(target) {
  return {
    type: WHISPERS_SESSION_DEACTIVATE,
    payload: { target },
  }
}

export function navigateToWhisper(target) {
  return push(`/whispers/${encodeURIComponent(target)}`)
}
