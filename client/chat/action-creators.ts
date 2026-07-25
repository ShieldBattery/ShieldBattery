import {
  ChannelModerationAction,
  ChannelPermissions,
  ChatServiceErrorCode,
  EditChannelRequest,
  EditChannelResponse,
  GetBatchedChannelInfosResponse,
  GetChannelHistoryServerResponse,
  GetChannelInfoResponse,
  GetChannelUserPermissionsResponse,
  GetChatUserProfileResponse,
  InitialChannelData,
  JoinChannelResponse,
  ListUserChannelEntriesResponse,
  ModerateChannelUserServerRequest,
  SbChannelId,
  SearchChannelsResponse,
  SendChatMessageServerRequest,
  TransferChannelOwnershipRequest,
  UpdateChannelUserPermissionsRequest,
  UpdateChannelUserPreferencesRequest,
} from '../../common/chat'
import { getErrorStack } from '../../common/errors'
import { apiUrl, urlPath } from '../../common/urls'
import { SbUser } from '../../common/users/sb-user'
import { SbUserId } from '../../common/users/sb-user-id'
import { openDialog } from '../dialogs/action-creators'
import { DialogType } from '../dialogs/dialog-type'
import { ThunkAction } from '../dispatch-registry'
import i18n from '../i18n/i18next'
import logger from '../logging/logger'
import { push, replace } from '../navigation/routing'
import { RequestHandlingSpec, abortableThunk } from '../network/abortable-thunk'
import { MicrotaskBatchRequester } from '../network/batch-requests'
import { encodeBodyAsParams, fetchJson } from '../network/fetch'
import { isFetchError } from '../network/fetch-errors'
import { RequestCoalescer } from '../network/request-coalescer'
import { RootState } from '../root-reducer'
import { externalShowSnackbar } from '../snackbars/snackbar-controller-registry'
import { DURATION_LONG } from '../snackbars/snackbar-durations'
import { ActivateChannel, DeactivateChannel } from './actions'

export function getJoinedChannels(spec: RequestHandlingSpec<void>): ThunkAction {
  return abortableThunk(spec, async dispatch => {
    const joinedChannels = await fetchJson<InitialChannelData[]>(apiUrl`chat/joined-channels`, {
      method: 'GET',
      signal: spec.signal,
    })

    dispatch({
      type: '@chat/getJoinedChannels',
      payload: joinedChannels,
    })
  })
}

/**
 * Makes a request to join a user to the channel. The caller is expected to handle errors.
 */
export function joinChannel(
  channelName: string,
  spec: RequestHandlingSpec<JoinChannelResponse>,
): ThunkAction {
  return abortableThunk(spec, async () => {
    return await fetchJson(apiUrl`chat/join/${channelName}`, {
      method: 'POST',
      signal: spec.signal,
    })
  })
}

/**
 * Makes a request to join a user to the channel. This function has built-in error handling.
 */
export function joinChannelWithErrorHandling(
  channelName: string,
  spec: RequestHandlingSpec<void>,
): ThunkAction {
  return abortableThunk(spec, async dispatch => {
    return fetchJson<JoinChannelResponse>(apiUrl`chat/join/${channelName}`, {
      method: 'POST',
      signal: spec.signal,
    })
      .then(channel => navigateToChannel(channel.channelInfo.id, channel.channelInfo.name))
      .catch(err => {
        let message = i18n.t('chat.joinChannel.genericError', {
          defaultValue: 'An error occurred while joining #{{channelName}}',
          channelName,
        })

        if (isFetchError(err) && err.code) {
          if (err.code === ChatServiceErrorCode.MaximumJoinedChannels) {
            message = i18n.t(
              'chat.joinChannel.maximumChannelsError',
              'You have reached the limit of joined channels. ' +
                'You must leave one before you can join another.',
            )
          } else if (err.code === ChatServiceErrorCode.UserBanned) {
            message = i18n.t('chat.joinChannel.bannedError', {
              defaultValue: 'You are banned from #{{channelName}}',
              channelName,
            })
          } else {
            logger.error(`Unhandled code when joining ${channelName}: ${err.code}`)
          }
        } else {
          logger.error(`Error when joining ${channelName}: ${err.stack ?? err}`)
        }

        externalShowSnackbar(message, DURATION_LONG)

        throw err
      })
  })
}

export function updateChannel({
  channelId,
  channelChanges,
  channelBanner,
  channelBadge,
  spec,
}: {
  channelId: SbChannelId
  channelChanges: EditChannelRequest
  channelBanner?: File
  channelBadge?: File
  spec: RequestHandlingSpec<void>
}): ThunkAction {
  return abortableThunk(spec, async dispatch => {
    if (
      Object.values(channelChanges).filter(c => c !== undefined).length === 0 &&
      !channelBanner &&
      !channelBadge
    ) {
      return
    }

    const formData = new FormData()
    formData.append(
      'channelChanges',
      JSON.stringify(channelChanges, (_, value) => (value === '' ? null : value)),
    )

    if (channelBanner) {
      formData.append('banner', channelBanner)
    }
    if (channelBadge) {
      formData.append('badge', channelBadge)
    }

    const result = await fetchJson<EditChannelResponse>(apiUrl`chat/${channelId}`, {
      method: 'PATCH',
      signal: spec.signal,
      body: formData,
    })

    dispatch({
      type: '@chat/getChannelInfo',
      payload: result,
      meta: {
        channelId,
      },
    })
  })
}

export function updateChannelUserPreferences(
  channelId: SbChannelId,
  preferences: UpdateChannelUserPreferencesRequest,
  spec: RequestHandlingSpec<void>,
) {
  return abortableThunk(spec, async () => {
    return await fetchJson(apiUrl`chat/${channelId}/user-preferences`, {
      method: 'POST',
      body: encodeBodyAsParams<UpdateChannelUserPreferencesRequest>(preferences),
      signal: spec.signal,
    })
  })
}

export function leaveChannel(
  channelId: SbChannelId,
  spec?: RequestHandlingSpec<void>,
): ThunkAction {
  return dispatch => {
    const params = { channelId }
    dispatch({
      type: '@chat/leaveChannelBegin',
      payload: params,
    })

    spec?.onStart?.()

    const result = fetchJson<void>(apiUrl`chat/${channelId}`, { method: 'DELETE' })

    dispatch({
      type: '@chat/leaveChannel',
      payload: result,
      meta: params,
    })

    if (spec) {
      result.then(spec.onSuccess, spec.onError)
    }
  }
}

/**
 * The consequence a channel member would suffer by leaving, ordered from least to most severe.
 * `None` means they have nothing to lose by leaving right now.
 */
export enum ChannelLeaveSeverity {
  None = 'none',
  LosePermissions = 'losePermissions',
  LoseOwnership = 'loseOwnership',
  DeleteChannel = 'deleteChannel',
}

/**
 * Determines what a given user stands to lose by leaving a channel: their channel permissions,
 * their ownership (which passes to someone else and can't be reclaimed), or the channel itself
 * (permanently, along with its message history) if they're its last member. Official channels are
 * never deleted when empty, so they never produce `DeleteChannel`.
 */
export function getChannelLeaveSeverity(
  state: RootState,
  channelId: SbChannelId,
  selfId: SbUserId,
): ChannelLeaveSeverity {
  const isOfficial = state.chat.idToBasicInfo.get(channelId)?.official ?? false
  const isLastMember = (state.chat.idToDetailedInfo.get(channelId)?.userCount ?? 0) <= 1
  const isOwner = state.chat.idToJoinedInfo.get(channelId)?.ownerId === selfId
  const selfPermissions = state.chat.idToSelfPermissions.get(channelId)
  const hasPermissions = selfPermissions ? Object.values(selfPermissions).some(Boolean) : false

  if (isLastMember && !isOfficial) {
    return ChannelLeaveSeverity.DeleteChannel
  }
  if (isOwner) {
    return ChannelLeaveSeverity.LoseOwnership
  }
  if (hasPermissions) {
    return ChannelLeaveSeverity.LosePermissions
  }

  return ChannelLeaveSeverity.None
}

/**
 * Leaves a channel, first prompting the user for confirmation if doing so would cost them
 * anything. Channel-hopping with nothing at stake stays a single click.
 */
export function leaveChannelWithConfirmation(channelId: SbChannelId): ThunkAction {
  return (dispatch, getState) => {
    const state = getState()
    const severity = getChannelLeaveSeverity(state, channelId, state.auth.self!.user.id)

    if (severity === ChannelLeaveSeverity.None) {
      dispatch(leaveChannel(channelId))
    } else {
      dispatch(
        openDialog({
          type: DialogType.ChannelLeaveConfirmation,
          initData: { channelId },
        }),
      )
    }
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
      signal: spec.signal,
    })
  })
}

/**
 * Hands the ownership of a chat channel over to another one of its members. Only the channel's
 * current owner can do this.
 */
export function transferChannelOwnership(
  channelId: SbChannelId,
  targetId: SbUserId,
  spec: RequestHandlingSpec<void>,
): ThunkAction {
  return abortableThunk(spec, async () => {
    await fetchJson<void>(apiUrl`chat/${channelId}/owner`, {
      method: 'POST',
      body: encodeBodyAsParams<TransferChannelOwnershipRequest>({ targetId }),
      signal: spec.signal,
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

export function deleteMessageAsAdmin(
  channelId: SbChannelId,
  messageId: string,
  spec: RequestHandlingSpec,
): ThunkAction {
  return abortableThunk(spec, async () => {
    await fetchJson<void>(apiUrl`admin/chat/${channelId}/messages/${messageId}`, {
      method: 'DELETE',
      signal: spec.signal,
    })
  })
}

/**
 * Moderates a user (kicks or bans them) in a chat channel through the membership-free admin
 * endpoint, for staff that aren't necessarily a member of the channel.
 */
export function moderateUserAsAdmin(
  channelId: SbChannelId,
  userId: SbUserId,
  moderationAction: ChannelModerationAction,
  spec: RequestHandlingSpec<void>,
  moderationReason?: string,
): ThunkAction {
  return abortableThunk(spec, async () => {
    return fetchJson<void>(apiUrl`admin/chat/${channelId}/users/${userId}/remove`, {
      method: 'POST',
      body: encodeBodyAsParams<ModerateChannelUserServerRequest>({
        moderationAction,
        moderationReason,
      }),
      signal: spec.signal,
    })
  })
}

/**
 * Hands the ownership of a chat channel over to one of its members through the membership-free
 * admin endpoint, for staff that aren't necessarily a member of the channel.
 */
export function transferChannelOwnershipAsAdmin(
  channelId: SbChannelId,
  targetId: SbUserId,
  spec: RequestHandlingSpec<void>,
): ThunkAction {
  return abortableThunk(spec, async () => {
    await fetchJson<void>(apiUrl`admin/chat/${channelId}/owner`, {
      method: 'POST',
      body: encodeBodyAsParams<TransferChannelOwnershipRequest>({ targetId }),
      signal: spec.signal,
    })
  })
}

/**
 * Fetches a user's permissions in a chat channel through the membership-free admin endpoint, for
 * staff that aren't necessarily a member of the channel.
 */
export function getChannelUserPermissionsAsAdmin(
  channelId: SbChannelId,
  targetId: SbUserId,
  spec: RequestHandlingSpec<GetChannelUserPermissionsResponse>,
): ThunkAction {
  return abortableThunk(spec, async () => {
    return await fetchJson<GetChannelUserPermissionsResponse>(
      apiUrl`admin/chat/${channelId}/users/${targetId}/permissions`,
      { signal: spec.signal },
    )
  })
}

/**
 * Updates a user's permissions in a chat channel through the membership-free admin endpoint, for
 * staff that aren't necessarily a member of the channel.
 */
export function updateChannelUserPermissionsAsAdmin(
  channelId: SbChannelId,
  targetId: SbUserId,
  permissions: ChannelPermissions,
  spec: RequestHandlingSpec<void>,
): ThunkAction {
  return abortableThunk(spec, async () => {
    await fetchJson<void>(apiUrl`admin/chat/${channelId}/users/${targetId}/permissions`, {
      method: 'POST',
      body: JSON.stringify({ permissions } satisfies UpdateChannelUserPermissionsRequest),
      signal: spec.signal,
    })
  })
}

/**
 * Lists the user channel entries for a chat channel through the membership-free admin endpoint,
 * for staff that aren't necessarily a member of the channel.
 */
export function listUserChannelEntriesAsAdmin(
  channelId: SbChannelId,
  searchQuery: string,
  offset: number,
  spec: RequestHandlingSpec<ListUserChannelEntriesResponse>,
): ThunkAction {
  return abortableThunk(spec, async dispatch => {
    const queryParams = new URLSearchParams()
    if (searchQuery) {
      queryParams.set('q', searchQuery)
    }
    queryParams.set('offset', offset.toString())

    const result = await fetchJson<ListUserChannelEntriesResponse>(
      apiUrl`admin/chat/${channelId}/user-channel-entries?${queryParams}`,
      { signal: spec.signal },
    )

    dispatch({
      type: '@users/loadUsers',
      payload: result.users,
    })

    return result
  })
}

/**
 * Updates a chat channel's info (topic, description, banner, badge, etc.) through the
 * membership-free admin endpoint, for staff that aren't necessarily a member of the channel.
 */
export function updateChannelAsAdmin({
  channelId,
  channelChanges,
  channelBanner,
  channelBadge,
  spec,
}: {
  channelId: SbChannelId
  channelChanges: EditChannelRequest
  channelBanner?: File
  channelBadge?: File
  spec: RequestHandlingSpec<void>
}): ThunkAction {
  return abortableThunk(spec, async dispatch => {
    if (
      Object.values(channelChanges).filter(c => c !== undefined).length === 0 &&
      !channelBanner &&
      !channelBadge
    ) {
      return
    }

    const formData = new FormData()
    formData.append(
      'channelChanges',
      JSON.stringify(channelChanges, (_, value) => (value === '' ? null : value)),
    )

    if (channelBanner) {
      formData.append('banner', channelBanner)
    }
    if (channelBadge) {
      formData.append('badge', channelBadge)
    }

    const result = await fetchJson<EditChannelResponse>(apiUrl`admin/chat/${channelId}`, {
      method: 'PATCH',
      signal: spec.signal,
      body: formData,
    })

    dispatch({
      type: '@chat/getChannelInfo',
      payload: result,
      meta: {
        channelId,
      },
    })
  })
}

export function getMessageHistory(channelId: SbChannelId, limit: number): ThunkAction {
  return (dispatch, getStore) => {
    const {
      chat: { idToMessages },
    } = getStore()
    const channelMessages = idToMessages.get(channelId)
    const earliestMessageTime = channelMessages?.messages.length
      ? channelMessages.messages[0].time
      : -1
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
      chat: { idToUsers },
    } = getStore()
    const channelUsers = idToUsers.get(channelId)
    if (channelUsers?.hasLoadedUserList || channelUsers?.loadingUserList) {
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

const getChatUserProfileRequestCoalescer = new RequestCoalescer<`${SbChannelId}|${SbUserId}`>()

export function getChatUserProfile(
  channelId: SbChannelId,
  targetId: SbUserId,
  spec: RequestHandlingSpec<void>,
): ThunkAction {
  return abortableThunk(spec, async (dispatch, getStore) => {
    await getChatUserProfileRequestCoalescer.makeRequest(
      `${channelId}|${targetId}`,
      spec.signal,
      async (signal: AbortSignal) => {
        dispatch({
          type: '@chat/getChatUserProfile',
          payload: await fetchJson<GetChatUserProfileResponse>(
            apiUrl`chat/${channelId}/users/${targetId}`,
            {
              method: 'GET',
              signal,
            },
          ),
        })
      },
    )
  })
}

export function getChannelInfo(
  channelId: SbChannelId,
  spec: RequestHandlingSpec<void>,
): ThunkAction {
  return abortableThunk(spec, async dispatch => {
    dispatch({
      type: '@chat/getChannelInfo',
      payload: await fetchJson<GetChannelInfoResponse>(apiUrl`chat/${channelId}`, {
        method: 'GET',
        signal: spec.signal,
      }),
      meta: { channelId },
    })
  })
}

const MAX_BATCH_CHANNEL_REQUESTS = 40

const channelsBatchRequester = new MicrotaskBatchRequester<SbChannelId>(
  MAX_BATCH_CHANNEL_REQUESTS,
  (dispatch, items) => {
    const params = items.map(c => urlPath`c=${c}`).join('&')
    const promise = fetchJson<GetBatchedChannelInfosResponse>(
      apiUrl`chat/batch-info` + '?' + params,
    )
    dispatch({
      type: '@chat/getBatchChannelInfo',
      payload: promise,
    })

    return promise
  },
  err => {
    logger.error('error while batch requesting channels: ' + getErrorStack(err))
  },
)

/**
 * Queues a request to the server for channel information, if necessary. This will batch multiple
 * requests that happen close together into one request to the server.
 */
export function getBatchChannelInfo(channelId: SbChannelId): ThunkAction {
  return (dispatch, getState) => {
    const {
      chat: { idToBasicInfo, idToDetailedInfo },
    } = getState()

    if (!idToBasicInfo.has(channelId) || !idToDetailedInfo.has(channelId)) {
      channelsBatchRequester.request(dispatch, channelId)
    }
  }
}

export function searchChannels(
  searchQuery: string,
  offset: number,
  spec: RequestHandlingSpec<SearchChannelsResponse>,
): ThunkAction {
  return abortableThunk(spec, async dispatch => {
    const result = await fetchJson<SearchChannelsResponse>(
      apiUrl`chat/?q=${searchQuery}&offset=${offset}`,
      {
        signal: spec.signal,
      },
    )

    dispatch({
      type: '@chat/searchChannels',
      payload: result,
    })

    return result
  })
}

export function listUserChannelEntries(
  channelId: SbChannelId,
  searchQuery: string,
  offset: number,
  spec: RequestHandlingSpec<ListUserChannelEntriesResponse>,
): ThunkAction {
  return abortableThunk(spec, async dispatch => {
    const queryParams = new URLSearchParams()
    if (searchQuery) {
      queryParams.set('q', searchQuery)
    }
    queryParams.set('offset', offset.toString())

    const result = await fetchJson<ListUserChannelEntriesResponse>(
      apiUrl`chat/${channelId}/user-channel-entries?${queryParams}`,
      { signal: spec.signal },
    )

    dispatch({
      type: '@users/loadUsers',
      payload: result.users,
    })

    return result
  })
}

export function updateChannelUserPermissions(
  channelId: SbChannelId,
  targetId: SbUserId,
  permissions: ChannelPermissions,
  spec: RequestHandlingSpec<void>,
): ThunkAction {
  return abortableThunk(spec, async () => {
    await fetchJson<void>(apiUrl`chat/${channelId}/users/${targetId}/permissions`, {
      method: 'POST',
      body: JSON.stringify({ permissions } satisfies UpdateChannelUserPermissionsRequest),
      signal: spec.signal,
    })
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

export function navigateToChannel(channelId: SbChannelId, channelName: string) {
  push(urlPath`/chat/${channelId}/${channelName}`)
}

/**
 * Corrects the URL for a specific chat channel if it is already being viewed. This is meant to be
 * used when the client arrived on the page but the channel name doesn't match what we have stored
 * for their channel ID.
 */
export function correctChannelNameForChat(channelId: SbChannelId, channelName: string) {
  replace(urlPath`/chat/${channelId}/${channelName}`)
}
