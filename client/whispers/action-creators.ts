import { SendWhisperMessageServerBody, WhisperMessage } from '../../common/whispers'
import { ThunkAction } from '../dispatch-registry'
import { push } from '../navigation/routing'
import fetch from '../network/fetch'
import { apiUrl } from '../network/urls'
import { ActivateWhisperSession, DeactivateWhisperSession } from './actions'

export function startWhisperSession(target: string): ThunkAction {
  return dispatch => {
    const params = { target }
    dispatch({
      type: '@whispers/startWhisperSessionBegin',
      payload: params,
    })
    dispatch({
      type: '@whispers/startWhisperSession',
      payload: fetch<void>(apiUrl`whispers/${target}`, { method: 'POST' }),
      meta: params,
    })
  }
}

export function closeWhisperSession(target: string): ThunkAction {
  return dispatch => {
    const params = { target }
    dispatch({
      type: '@whispers/closeWhisperSessionBegin',
      payload: params,
    })
    dispatch({
      type: '@whispers/closeWhisperSession',
      payload: fetch<void>(apiUrl`whispers/${target}`, { method: 'DELETE' }),
      meta: params,
    })
  }
}

export function sendMessage(target: string, message: string): ThunkAction {
  return dispatch => {
    const params = { target, message }
    dispatch({
      type: '@whispers/sendMessageBegin',
      payload: params,
    })

    const requestBody: SendWhisperMessageServerBody = { message }
    dispatch({
      type: '@whispers/sendMessage',
      payload: fetch<void>(apiUrl`whispers/${target}/messages`, {
        method: 'POST',
        body: JSON.stringify(requestBody),
      }),
      meta: params,
    })
  }
}

export function getMessageHistory(target: string, limit: number): ThunkAction {
  return (dispatch, getStore) => {
    const {
      whispers: { byName },
    } = getStore()
    const lowerCaseTarget = target.toLowerCase()
    if (!byName.has(lowerCaseTarget)) {
      return
    }

    const sessionData = byName.get(lowerCaseTarget)!
    const earliestMessageTime = sessionData.messages.first({ time: -1 }).time
    const params = { target, limit, beforeTime: earliestMessageTime }

    dispatch({
      type: '@whispers/loadMessageHistoryBegin',
      payload: params,
    })
    dispatch({
      type: '@whispers/loadMessageHistory',
      payload: fetch<WhisperMessage[]>(
        apiUrl`whispers/${target}/messages?limit=${limit}&beforeTime=${earliestMessageTime}`,
        { method: 'GET' },
      ),
      meta: params,
    })
  }
}

export function activateWhisperSession(target: string): ActivateWhisperSession {
  return {
    type: '@whispers/activateWhisperSession',
    payload: { target },
  }
}

export function deactivateWhisperSession(target: string): DeactivateWhisperSession {
  return {
    type: '@whispers/deactivateWhisperSession',
    payload: { target },
  }
}

export function navigateToWhisper(target: string) {
  push(`/whispers/${encodeURIComponent(target)}`)
}
