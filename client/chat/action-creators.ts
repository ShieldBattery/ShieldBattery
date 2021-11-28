import { GetChannelHistoryServerPayload, SendChatMessageServerBody } from '../../common/chat'
import { apiUrl } from '../../common/urls'
import { SbUser } from '../../common/users/user-info'
import { ThunkAction } from '../dispatch-registry'
import { push } from '../navigation/routing'
import { fetchJson } from '../network/fetch'
import { ActivateChannel, DeactivateChannel } from './actions'

export function joinChannel(channel: string): ThunkAction {
  return dispatch => {
    const params = { channel }
    dispatch({
      type: '@chat/joinChannelBegin',
      payload: params,
    })
    dispatch({
      type: '@chat/joinChannel',
      payload: fetchJson<void>(apiUrl`chat/${channel}`, { method: 'POST' }),
      meta: params,
    })
  }
}

export function leaveChannel(channel: string): ThunkAction {
  return dispatch => {
    const params = { channel }
    dispatch({
      type: '@chat/leaveChannelBegin',
      payload: params,
    })
    dispatch({
      type: '@chat/leaveChannel',
      payload: fetchJson<void>(apiUrl`chat/${channel}`, { method: 'DELETE' }),
      meta: params,
    })
  }
}

export function sendMessage(channel: string, message: string): ThunkAction {
  return dispatch => {
    const params = { channel, message }
    dispatch({
      type: '@chat/sendMessageBegin',
      payload: params,
    })

    const requestBody: SendChatMessageServerBody = { message }
    dispatch({
      type: '@chat/sendMessage',
      payload: fetchJson<void>(apiUrl`chat/${channel}/messages`, {
        method: 'POST',
        body: JSON.stringify(requestBody),
      }),
      meta: params,
    })
  }
}

export function getMessageHistory(channel: string, limit: number): ThunkAction {
  return (dispatch, getStore) => {
    const {
      chat: { byName },
    } = getStore()
    const lowerCaseChannel = channel.toLowerCase()
    if (!byName.has(lowerCaseChannel)) {
      return
    }

    const chanData = byName.get(lowerCaseChannel)!
    const earliestMessageTime = chanData.messages.length ? chanData.messages[0].time : -1
    const params = { channel, limit, beforeTime: earliestMessageTime }

    dispatch({
      type: '@chat/loadMessageHistoryBegin',
      payload: params,
    })
    dispatch({
      type: '@chat/loadMessageHistory',
      payload: fetchJson<GetChannelHistoryServerPayload>(
        apiUrl`chat/${channel}/messages2?limit=${limit}&beforeTime=${earliestMessageTime}`,
        { method: 'GET' },
      ),
      meta: params,
    })
  }
}

export function retrieveUserList(channel: string): ThunkAction {
  return (dispatch, getStore) => {
    const {
      chat: { byName },
    } = getStore()
    const lowerCaseChannel = channel.toLowerCase()
    if (!byName.has(lowerCaseChannel)) {
      return
    }

    const chanData = byName.get(lowerCaseChannel)!
    if (chanData.hasLoadedUserList || chanData.loadingUserList) {
      return
    }

    const params = { channel }
    dispatch({
      type: '@chat/retrieveUserListBegin',
      payload: params,
    })
    dispatch({
      type: '@chat/retrieveUserList',
      payload: fetch<SbUser[]>(apiUrl`chat/${channel}/users2`, {
        method: 'GET',
      }),
      meta: params,
    })
  }
}

export function activateChannel(channel: string): ActivateChannel {
  return {
    type: '@chat/activateChannel',
    payload: { channel },
  }
}

export function deactivateChannel(channel: string): DeactivateChannel {
  return {
    type: '@chat/deactivateChannel',
    payload: { channel },
  }
}

export function navigateToChannel(channel: string) {
  push(`/chat/${encodeURIComponent(channel)}`)
}
