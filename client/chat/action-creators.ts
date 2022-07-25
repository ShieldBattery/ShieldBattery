import {
  ChannelModerationAction,
  GetChannelHistoryServerResponse,
  GetChatUserProfileResponse,
  ModerateChannelUserServerRequest,
  SbChannelId,
  SendChatMessageServerRequest,
} from '../../common/chat'
import { apiUrl, urlPath } from '../../common/urls'
import { SbUser, SbUserId } from '../../common/users/sb-user'
import { ThunkAction } from '../dispatch-registry'
import { push, replace } from '../navigation/routing'
import { abortableThunk, RequestHandlingSpec } from '../network/abortable-thunk'
import { encodeBodyAsParams, fetchJson } from '../network/fetch'
import { ActivateChannel, DeactivateChannel } from './actions'

export function joinChannel(channelId: SbChannelId, spec: RequestHandlingSpec<void>): ThunkAction {
  return abortableThunk(spec, async dispatch => {
    return fetchJson<void>(apiUrl`chat/${channelId}`, { method: 'POST' })
  })
}

export function leaveChannel(channelId: SbChannelId): ThunkAction {
  return dispatch => {
    const params = { channelId }
    dispatch({
      type: '@chat/leaveChannelBegin',
      payload: params,
    })
    dispatch({
      type: '@chat/leaveChannel',
      payload: fetchJson<void>(apiUrl`chat/${channelId}`, { method: 'DELETE' }),
      meta: params,
    })
  }
}

export function moderateUser(
  channelId: SbChannelId,
  userId: SbUserId,
  moderationAction: ChannelModerationAction,
  spec: RequestHandlingSpec<void>,
  moderationReason?: string,
): ThunkAction {
  return abortableThunk(spec, async () => {
    return fetchJson<void>(apiUrl`chat/${channelId}/users/${userId}/remove`, {
      method: 'POST',
      body: encodeBodyAsParams<ModerateChannelUserServerRequest>({
        moderationAction,
        moderationReason,
      }),
    })
  })
}

export function sendMessage(channelId: SbChannelId, message: string): ThunkAction {
  return dispatch => {
    const params = { channelId, message }
    dispatch({
      type: '@chat/sendMessageBegin',
      payload: params,
    })

    dispatch({
      type: '@chat/sendMessage',
      payload: fetchJson<void>(apiUrl`chat/${channelId}/messages`, {
        method: 'POST',
        body: encodeBodyAsParams<SendChatMessageServerRequest>({ message }),
      }),
      meta: params,
    })
  }
}

export function getMessageHistory(channelId: SbChannelId, limit: number): ThunkAction {
  return (dispatch, getStore) => {
    const {
      chat: { byId },
    } = getStore()
    const chanData = byId.get(channelId)
    if (!chanData) {
      return
    }

    const earliestMessageTime = chanData.messages.length ? chanData.messages[0].time : -1
    const params = { channelId, limit, beforeTime: earliestMessageTime }

    dispatch({
      type: '@chat/loadMessageHistoryBegin',
      payload: params,
    })
    dispatch({
      type: '@chat/loadMessageHistory',
      payload: fetchJson<GetChannelHistoryServerResponse>(
        apiUrl`chat/${channelId}/messages2?limit=${limit}&beforeTime=${earliestMessageTime}`,
        { method: 'GET' },
      ),
      meta: params,
    })
  }
}

export function retrieveUserList(channelId: SbChannelId): ThunkAction {
  return (dispatch, getStore) => {
    const {
      chat: { byId },
    } = getStore()
    const chanData = byId.get(channelId)
    if (!chanData) {
      return
    }

    if (chanData.hasLoadedUserList || chanData.loadingUserList) {
      return
    }

    const params = { channelId }
    dispatch({
      type: '@chat/retrieveUserListBegin',
      payload: params,
    })
    dispatch({
      type: '@chat/retrieveUserList',
      payload: fetchJson<SbUser[]>(apiUrl`chat/${channelId}/users2`, {
        method: 'GET',
      }),
      meta: params,
    })
  }
}

const chatUserProfileLoadsInProgress = new Set<`${SbChannelId}|${SbUserId}`>()

export function getChatUserProfile(
  channelId: SbChannelId,
  targetId: SbUserId,
  spec: RequestHandlingSpec<void>,
): ThunkAction {
  return abortableThunk(spec, async (dispatch, getStore) => {
    const {
      chat: { byId },
    } = getStore()
    if (!byId.has(channelId)) {
      return
    }

    const channelTargetId: `${SbChannelId}|${SbUserId}` = `${channelId}|${targetId}`
    if (chatUserProfileLoadsInProgress.has(channelTargetId)) {
      return
    }
    chatUserProfileLoadsInProgress.add(channelTargetId)

    try {
      dispatch({
        type: '@chat/getChatUserProfile',
        payload: await fetchJson<GetChatUserProfileResponse>(
          apiUrl`chat/${channelId}/users/${targetId}`,
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

export function activateChannel(channelId: SbChannelId): ActivateChannel {
  return {
    type: '@chat/activateChannel',
    payload: { channelId },
  }
}

export function deactivateChannel(channelId: SbChannelId): DeactivateChannel {
  return {
    type: '@chat/deactivateChannel',
    payload: { channelId },
  }
}

export function navigateToChannel(channel: string) {
  push(`/chat/${encodeURIComponent(channel)}`)
}

/**
 * Corrects the URL for a specific chat channel if it is already being viewed. This is meant to be
 * used when the client arrived on the page but the channel name doesn't match what we have stored
 * for their channel ID.
 */
export function correctChannelNameForChat(channelId: SbChannelId, channelName: string) {
  replace(urlPath`/chat/${channelId}/${channelName}`)
}
