import {
  ChannelModerationAction,
  GetChannelHistoryServerResponse,
  GetChatUserProfileResponse,
  ModerateChannelUserServerRequest,
  SendChatMessageServerRequest,
} from '../../common/chat'
import { apiUrl } from '../../common/urls'
import { SbUser, SbUserId } from '../../common/users/sb-user'
import { ThunkAction } from '../dispatch-registry'
import { push } from '../navigation/routing'
import { abortableThunk, RequestHandlingSpec } from '../network/abortable-thunk'
import { encodeBodyAsParams, fetchJson } from '../network/fetch'
import { ActivateChannel, DeactivateChannel } from './actions'

export function joinChannel(channel: string, spec: RequestHandlingSpec<void>): ThunkAction {
  return abortableThunk(spec, async dispatch => {
    return fetchJson<void>(apiUrl`chat/${channel}`, { method: 'POST' })
  })
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

export function moderateUser(
  channel: string,
  userId: SbUserId,
  moderationAction: ChannelModerationAction,
  spec: RequestHandlingSpec<void>,
  moderationReason?: string,
): ThunkAction {
  return abortableThunk(spec, async () => {
    return fetchJson<void>(apiUrl`chat/${channel}/users/${userId}/remove`, {
      method: 'POST',
      body: encodeBodyAsParams<ModerateChannelUserServerRequest>({
        moderationAction,
        moderationReason,
      }),
    })
  })
}

export function sendMessage(channel: string, message: string): ThunkAction {
  return dispatch => {
    const params = { channel, message }
    dispatch({
      type: '@chat/sendMessageBegin',
      payload: params,
    })

    dispatch({
      type: '@chat/sendMessage',
      payload: fetchJson<void>(apiUrl`chat/${channel}/messages`, {
        method: 'POST',
        body: encodeBodyAsParams<SendChatMessageServerRequest>({ message }),
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
      payload: fetchJson<GetChannelHistoryServerResponse>(
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
      payload: fetchJson<SbUser[]>(apiUrl`chat/${channel}/users2`, {
        method: 'GET',
      }),
      meta: params,
    })
  }
}

const chatUserProfileLoadsInProgress = new Set<`${string}|${SbUserId}`>()

export function getChatUserProfile(
  channel: string,
  targetId: SbUserId,
  spec: RequestHandlingSpec<void>,
): ThunkAction {
  return abortableThunk(spec, async (dispatch, getStore) => {
    const {
      chat: { byName },
    } = getStore()
    const lowerCaseChannel = channel.toLowerCase()
    if (!byName.has(lowerCaseChannel)) {
      return
    }

    const channelTargetId: `${string}|${SbUserId}` = `${channel}|${targetId}`
    if (chatUserProfileLoadsInProgress.has(channelTargetId)) {
      return
    }
    chatUserProfileLoadsInProgress.add(channelTargetId)

    try {
      dispatch({
        type: '@chat/getChatUserProfile',
        payload: await fetchJson<GetChatUserProfileResponse>(
          apiUrl`chat/${channel}/users/${targetId}`,
          {
            method: 'GET',
          },
        ),
      })
    } finally {
      chatUserProfileLoadsInProgress.delete(channelTargetId)
    }
  })
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
