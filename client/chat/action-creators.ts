import {
  ChannelModerationAction,
  ChatServiceErrorCode,
  GetChannelHistoryServerResponse,
  GetChatUserProfileResponse,
  ModerateChannelUserServerRequest,
  SendChatMessageServerRequest,
} from '../../common/chat'
import { apiUrl } from '../../common/urls'
import { SbUser, SbUserId } from '../../common/users/sb-user'
import { ThunkAction } from '../dispatch-registry'
import logger from '../logging/logger'
import { push, replace } from '../navigation/routing'
import { abortableThunk, RequestHandlingSpec } from '../network/abortable-thunk'
import { encodeBodyAsParams, fetchJson } from '../network/fetch'
import { isFetchError } from '../network/fetch-errors'
import { openSnackbar, TIMING_LONG } from '../snackbars/action-creators'
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
      payload: fetchJson<void>(apiUrl`chat/${channel}`, { method: 'POST' }).catch(err => {
        // TODO(2Pac): Rework how joining channel works. Currently we first navigate to the channel
        // and then attempt to join it. Which seems weird to me?
        //
        // To work around this for now, if the user is banned we redirect them to the index page,
        // but ideally they wouldn't be navigated to the channel in the first place.
        replace('/')

        let message = `An error occurred while joining ${channel}`

        if (isFetchError(err) && err.code) {
          if (err.code === ChatServiceErrorCode.UserBanned) {
            message = `You are banned from ${channel}`
          } else {
            logger.error(`Unhandled code when joining ${channel}: ${err.code}`)
          }
        } else {
          logger.error(`Error when joining ${channel}: ${err.stack ?? err}`)
        }

        dispatch(openSnackbar({ message, time: TIMING_LONG }))
      }),
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

export function moderateUser(
  channel: string,
  userId: SbUserId,
  moderationAction: ChannelModerationAction,
  spec: RequestHandlingSpec<void>,
  moderationReason?: string,
): ThunkAction {
  return abortableThunk(spec, async () => {
    return fetchJson<void>(apiUrl`chat/${channel}/${userId}/remove`, {
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

const chatUserProfileLoadsInProgress = new Set<SbUserId>()

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

    if (chatUserProfileLoadsInProgress.has(targetId)) {
      return
    }
    chatUserProfileLoadsInProgress.add(targetId)

    try {
      dispatch({
        type: '@chat/getChatUserProfile',
        payload: await fetchJson<GetChatUserProfileResponse>(apiUrl`chat/${channel}/${targetId}`, {
          method: 'GET',
        }),
      })
    } finally {
      chatUserProfileLoadsInProgress.delete(targetId)
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
