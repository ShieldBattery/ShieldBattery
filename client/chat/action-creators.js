import {
  CHAT_CHANNEL_ACTIVATE,
  CHAT_CHANNEL_DEACTIVATE,
  CHAT_JOIN_CHANNEL,
  CHAT_JOIN_CHANNEL_BEGIN,
  CHAT_LEAVE_CHANNEL,
  CHAT_LEAVE_CHANNEL_BEGIN,
  CHAT_LOAD_CHANNEL_HISTORY,
  CHAT_LOAD_CHANNEL_HISTORY_BEGIN,
  CHAT_LOAD_USER_LIST,
  CHAT_LOAD_USER_LIST_BEGIN,
  CHAT_SEND_MESSAGE,
  CHAT_SEND_MESSAGE_BEGIN,
} from '../actions'
import { push } from '../navigation/routing'
import fetch from '../network/fetch'
import { apiUrl } from '../network/urls'

export function joinChannel(channel) {
  return dispatch => {
    const params = { channel }
    dispatch({
      type: CHAT_JOIN_CHANNEL_BEGIN,
      payload: params,
    })
    dispatch({
      type: CHAT_JOIN_CHANNEL,
      payload: fetch(apiUrl`chat/${channel}`, { method: 'POST' }),
      meta: params,
    })
  }
}

export function leaveChannel(channel) {
  return dispatch => {
    const params = { channel }
    dispatch({
      type: CHAT_LEAVE_CHANNEL_BEGIN,
      payload: params,
    })
    dispatch({
      type: CHAT_LEAVE_CHANNEL,
      payload: fetch(apiUrl`chat/${channel}`, { method: 'DELETE' }),
      meta: params,
    })
  }
}

export function sendMessage(channel, message) {
  return dispatch => {
    const params = { channel, message }
    dispatch({
      type: CHAT_SEND_MESSAGE_BEGIN,
      payload: params,
    })
    dispatch({
      type: CHAT_SEND_MESSAGE,
      payload: fetch(apiUrl`chat/${channel}/messages`, {
        method: 'POST',
        body: JSON.stringify({ message }),
      }),
      meta: params,
    })
  }
}

export function getMessageHistory(channel, limit) {
  return (dispatch, getStore) => {
    const {
      chat: { byName },
    } = getStore()
    const lowerCaseChannel = channel.toLowerCase()
    if (!byName.has(lowerCaseChannel)) {
      return
    }

    const chanData = byName.get(lowerCaseChannel)
    const earliestMessageTime = chanData.messages.size ? chanData.messages.first().time : -1
    const params = { channel, limit, beforeTime: earliestMessageTime }

    dispatch({
      type: CHAT_LOAD_CHANNEL_HISTORY_BEGIN,
      payload: params,
    })
    dispatch({
      type: CHAT_LOAD_CHANNEL_HISTORY,
      payload: fetch(
        apiUrl`chat/${channel}/messages?limit=${limit}&beforeTime=${earliestMessageTime}`,
        { method: 'GET' },
      ),
      meta: params,
    })
  }
}

export function retrieveUserList(channel) {
  return (dispatch, getStore) => {
    const {
      chat: { byName },
    } = getStore()
    const lowerCaseChannel = channel.toLowerCase()
    if (!byName.has(lowerCaseChannel)) {
      return
    }

    const chanData = byName.get(lowerCaseChannel)
    if (chanData.hasLoadedUserList || chanData.loadingUserList) {
      return
    }

    const params = { channel }
    dispatch({
      type: CHAT_LOAD_USER_LIST_BEGIN,
      payload: params,
    })
    dispatch({
      type: CHAT_LOAD_USER_LIST,
      payload: fetch(apiUrl`chat/${channel}/users`, { method: 'GET' }),
      meta: params,
    })
  }
}

export function activateChannel(channel) {
  return {
    type: CHAT_CHANNEL_ACTIVATE,
    payload: { channel },
  }
}

export function deactivateChannel(channel) {
  return {
    type: CHAT_CHANNEL_DEACTIVATE,
    payload: { channel },
  }
}

export function navigateToChannel(channel) {
  push(`/chat/${encodeURIComponent(channel)}`)
}
