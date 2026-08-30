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
  ListChannelBansResponse,
  ListUserChannelEntriesResponse,
  MarkChannelReadRequest,
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
import { reportLastRead } from '../messaging/last-read'
import { push, replace } from '../navigation/routing'
import { RequestHandlingSpec, abortableThunk } from '../network/abortable-thunk'
import { MicrotaskBatchRequester } from '../network/batch-requests'
import { encodeBodyAsParams, fetchJson } from '../network/fetch'
import { isFetchError } from '../network/fetch-errors'
import { RequestCoalescer } from '../network/request-coalescer'
import { RootState } from '../root-reducer'
import { externalShowSnackbar } from '../snackbars/snackbar-controller-registry'
import { DURATION_LONG } from '../snackbars/snackbar-durations'
import {
  ActivateChannel,
  DeactivateChannel,
  ResetMessageWindow,
  UpdateChannelAtBottom,
} from './actions'
import { newestServerOriginTime } from './chat-reducer'

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

/** The `reportLastRead`/`flushLastRead` coalescing key for a channel's read position. */
export function getChannelLastReadKey(channelId: SbChannelId): string {
  return `channel-${channelId}`
}

/**
 * Reports the newest message time the current user has read in a channel, coalescing rapid-fire
 * reports (see `reportLastRead`). Fire-and-forget: there's no `RequestHandlingSpec` since nothing
 * needs to react to this request's outcome.
 */
export function markChannelRead(channelId: SbChannelId, lastReadTime: number): ThunkAction {
  return dispatch => {
    // Advances the local read position immediately; the reducer's monotonic guard keeps this
    // correct even for reports the coalescer below ends up dropping.
    dispatch({
      type: '@chat/updateLastReadTime',
      payload: { channelId, lastReadTime },
    })

    reportLastRead(getChannelLastReadKey(channelId), lastReadTime, time => {
      fetchJson<void>(apiUrl`chat/${channelId}/mark-read`, {
        method: 'POST',
        body: encodeBodyAsParams<MarkChannelReadRequest>({ lastReadTime: time }),
      }).catch(err => {
        logger.error(
          `Error reporting read position for channel ${channelId}: ${getErrorStack(err)}`,
        )
      })
    })
  }
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
  spec: RequestHandlingSpec<void> = { onSuccess: () => {}, onError: () => {} },
): ThunkAction {
  return abortableThunk(spec, async dispatch => {
    const params = { channelId }
    dispatch({
      type: '@chat/leaveChannelBegin',
      payload: params,
    })

    const result = fetchJson<void>(apiUrl`chat/${channelId}`, {
      method: 'DELETE',
      signal: spec.signal,
    })

    dispatch({
      type: '@chat/leaveChannel',
      payload: result,
      meta: params,
    })

    return await result
  })
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
  // When the member count hasn't loaded, assume the channel is NOT about to be deleted — warning
  // about permanent deletion is the one outcome that must not be claimed on missing data.
  const isLastMember = (state.chat.idToDetailedInfo.get(channelId)?.userCount ?? Infinity) <= 1
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
 * current owner or a server moderator can do this.
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

export function getMessageHistory(channelId: SbChannelId, limit: number): ThunkAction {
  return (dispatch, getStore) => {
    const {
      chat: { idToMessages },
    } = getStore()
    const channelMessages = idToMessages.get(channelId)
    const earliestMessageTime = channelMessages?.messages.length
      ? channelMessages.messages[0].time
      : -1
    const params = {
      channelId,
      limit,
      beforeTime: earliestMessageTime,
      windowGen: channelMessages?.windowGen ?? 0,
    }

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

/**
 * Loads the page of messages that follows the newest one currently loaded for a channel, moving a
 * window that sits behind the present a page closer to it. Does nothing if the channel holds no
 * message with a server-recorded time, since there'd be nothing the server could seek from.
 */
export function getNewerMessages(channelId: SbChannelId, limit: number): ThunkAction {
  return (dispatch, getStore) => {
    const {
      chat: { idToMessages },
    } = getStore()
    const channelMessages = idToMessages.get(channelId)
    if (!channelMessages) {
      return
    }

    const afterTime = newestServerOriginTime(channelMessages.messages)
    if (afterTime === undefined) {
      return
    }

    const params = {
      channelId,
      limit,
      afterTime,
      windowGen: channelMessages.windowGen,
      knownNewestTime: Math.max(afterTime, channelMessages.detachedNewestTime ?? -Infinity),
    }

    dispatch({
      type: '@chat/loadNewerMessagesBegin',
      payload: params,
    })
    dispatch({
      type: '@chat/loadNewerMessages',
      payload: fetchJson<GetChannelHistoryServerResponse>(
        apiUrl`chat/${channelId}/messages2?limit=${limit}&afterTime=${afterTime}`,
        { method: 'GET' },
      ),
      meta: params,
    })
  }
}

/**
 * Loads a window of messages centered on `aroundTime`, replacing whatever is currently loaded for
 * the channel. This is how the client reaches a position that isn't adjacent to what it holds, such
 * as an unread divider that sits further back than the loaded history reaches.
 */
export function getMessagesAround(
  channelId: SbChannelId,
  limit: number,
  aroundTime: number,
): ThunkAction {
  return (dispatch, getStore) => {
    const {
      chat: { idToMessages },
    } = getStore()
    const channelMessages = idToMessages.get(channelId)
    if (!channelMessages) {
      return
    }

    const knownNewest = Math.max(
      newestServerOriginTime(channelMessages.messages) ?? -Infinity,
      channelMessages.detachedNewestTime ?? -Infinity,
    )
    const params = {
      channelId,
      limit,
      aroundTime,
      windowGen: channelMessages.windowGen,
      knownNewestTime: knownNewest === -Infinity ? undefined : knownNewest,
    }

    dispatch({
      type: '@chat/loadMessagesAroundBegin',
      payload: params,
    })
    dispatch({
      type: '@chat/loadMessagesAround',
      payload: fetchJson<GetChannelHistoryServerResponse>(
        apiUrl`chat/${channelId}/messages2?limit=${limit}&aroundTime=${aroundTime}`,
        { method: 'GET' },
      ),
      meta: params,
    })
  }
}

export function resetMessageWindow(channelId: SbChannelId): ResetMessageWindow {
  return {
    type: '@chat/resetMessageWindow',
    payload: { channelId },
  }
}

/**
 * Returns a channel's message list to the present, however far back it was left. The loaded window
 * is dropped and the newest page requested in the same tick, so the list never renders an empty
 * channel in between.
 */
export function jumpToPresent(channelId: SbChannelId, limit: number): ThunkAction {
  return dispatch => {
    dispatch(resetMessageWindow(channelId))
    dispatch(getMessageHistory(channelId, limit))
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

export function getChannelUserPermissions(
  channelId: SbChannelId,
  targetId: SbUserId,
  spec: RequestHandlingSpec<GetChannelUserPermissionsResponse>,
): ThunkAction {
  return abortableThunk(spec, async () => {
    return await fetchJson<GetChannelUserPermissionsResponse>(
      apiUrl`chat/${channelId}/users/${targetId}/permissions`,
      { signal: spec.signal },
    )
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

/**
 * Lists the active bans in a chat channel.
 */
export function listChannelBans(
  channelId: SbChannelId,
  searchQuery: string,
  offset: number,
  spec: RequestHandlingSpec<ListChannelBansResponse>,
): ThunkAction {
  return abortableThunk(spec, async dispatch => {
    const queryParams = new URLSearchParams()
    if (searchQuery) {
      queryParams.set('q', searchQuery)
    }
    queryParams.set('offset', offset.toString())

    const result = await fetchJson<ListChannelBansResponse>(
      apiUrl`chat/${channelId}/bans?${queryParams}`,
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
 * Lifts an active ban on a user in a chat channel.
 */
export function unbanUser(
  channelId: SbChannelId,
  targetId: SbUserId,
  spec: RequestHandlingSpec<void>,
): ThunkAction {
  return abortableThunk(spec, async () => {
    await fetchJson<void>(apiUrl`chat/${channelId}/bans/${targetId}`, {
      method: 'DELETE',
      signal: spec.signal,
    })
  })
}

export function activateChannel(channelId: SbChannelId, atBottom: boolean): ActivateChannel {
  return {
    type: '@chat/activateChannel',
    payload: { channelId, atBottom },
  }
}

export function deactivateChannel(channelId: SbChannelId): DeactivateChannel {
  return {
    type: '@chat/deactivateChannel',
    payload: { channelId },
  }
}

export function updateChannelAtBottom(
  channelId: SbChannelId,
  atBottom: boolean,
): UpdateChannelAtBottom {
  return {
    type: '@chat/updateChannelAtBottom',
    payload: { channelId, atBottom },
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
