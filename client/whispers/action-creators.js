import {
  WHISPERS_CLOSE_SESSION,
  WHISPERS_CLOSE_SESSION_BEGIN,
  WHISPERS_LOAD_SESSION_HISTORY,
  WHISPERS_LOAD_SESSION_HISTORY_BEGIN,
  WHISPERS_SEND_MESSAGE,
  WHISPERS_SEND_MESSAGE_BEGIN,
  WHISPERS_SESSION_ACTIVATE,
  WHISPERS_SESSION_DEACTIVATE,
  WHISPERS_START_SESSION,
  WHISPERS_START_SESSION_BEGIN,
} from '../actions'
import { push } from '../navigation/routing'
import siteSocket from '../network/site-socket'

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

export function getMessageHistory(target, limit) {
  return (dispatch, getStore) => {
    const {
      whispers: { byName },
    } = getStore()
    const lowerCaseTarget = target.toLowerCase()
    if (!byName.has(lowerCaseTarget)) {
      return
    }

    const sessionData = byName.get(lowerCaseTarget)
    const earliestMessageTime = sessionData.messages.size ? sessionData.messages.first().time : -1
    const params = { target, limit, beforeTime: earliestMessageTime }

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
  push(`/whispers/${encodeURIComponent(target)}`)
}
