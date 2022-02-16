import {
  ChatBanEvent,
  ChatInitEvent,
  ChatJoinEvent,
  ChatKickEvent,
  ChatLeaveEvent,
  ChatMessageEvent,
  ChatPermissionsChangedEvent,
  ChatUserActiveEvent,
  ChatUserIdleEvent,
  ChatUserOfflineEvent,
  GetChannelHistoryServerResponse,
  GetChatUserProfileResponse,
} from '../../common/chat'
import { SbUser } from '../../common/users/sb-user'
import { BaseFetchFailure } from '../network/fetch-errors'

export type ChatActions =
  | JoinChannelBegin
  | JoinChannel
  | JoinChannelFailure
  | LeaveChannelBegin
  | LeaveChannel
  | LeaveChannelFailure
  | SendMessageBegin
  | SendMessage
  | SendMessageFailure
  | LoadMessageHistoryBegin
  | LoadMessageHistory
  | LoadMessageHistoryFailure
  | RetrieveUserListBegin
  | RetrieveUserList
  | RetrieveUserListFailure
  | GetChatUserProfile
  | ActivateChannel
  | DeactivateChannel
  | InitChannel
  | UpdateJoin
  | UpdateLeave
  | UpdateLeaveSelf
  | UpdateKick
  | UpdateKickSelf
  | UpdateBan
  | UpdateBanSelf
  | UpdateMessage
  | UpdateUserActive
  | UpdateUserIdle
  | UpdateUserOffline
  | UpdateSelfPermissions

export interface JoinChannelBegin {
  type: '@chat/joinChannelBegin'
  payload: {
    channel: string
  }
}

/**
 * Makes the user join a channel. If a channel doesn't exist, it is created and user gets full
 * permissions in it.
 */
export interface JoinChannel {
  type: '@chat/joinChannel'
  payload: void
  meta: {
    channel: string
  }
  error?: false
}

export interface JoinChannelFailure extends BaseFetchFailure<'@chat/joinChannel'> {
  meta: {
    channel: string
  }
}

export interface LeaveChannelBegin {
  type: '@chat/leaveChannelBegin'
  payload: {
    channel: string
  }
}

/**
 * Makes the user leave a channel. If the user was the "owner" of the channel, a new "owner" will be
 * selected. If the user was the only member of the channel, the channel will be effectively reset.
 */
export interface LeaveChannel {
  type: '@chat/leaveChannel'
  payload: void
  meta: {
    channel: string
  }
  error?: false
}

export interface LeaveChannelFailure extends BaseFetchFailure<'@chat/leaveChannel'> {
  meta: {
    channel: string
  }
}

export interface SendMessageBegin {
  type: '@chat/sendMessageBegin'
  payload: {
    channel: string
    message: string
  }
}

/**
 * Send a chat message to a chat channel.
 */
export interface SendMessage {
  type: '@chat/sendMessage'
  payload: void
  meta: {
    channel: string
    message: string
  }
  error?: false
}

export interface SendMessageFailure extends BaseFetchFailure<'@chat/sendMessage'> {
  meta: {
    channel: string
    message: string
  }
}

export interface LoadMessageHistoryBegin {
  type: '@chat/loadMessageHistoryBegin'
  payload: {
    channel: string
    limit: number
    beforeTime: number
  }
}

/**
 * Loads the `limit` amount of messages in a chat channel before a particular time.
 */
export interface LoadMessageHistory {
  type: '@chat/loadMessageHistory'
  payload: GetChannelHistoryServerResponse
  meta: {
    channel: string
    limit: number
    beforeTime: number
  }
  error?: false
}

export interface LoadMessageHistoryFailure extends BaseFetchFailure<'@chat/loadMessageHistory'> {
  meta: {
    channel: string
    limit: number
    beforeTime: number
  }
}

export interface RetrieveUserListBegin {
  type: '@chat/retrieveUserListBegin'
  payload: {
    channel: string
  }
}

/**
 * Retrieve the full list of users in a particular channel.
 */
export interface RetrieveUserList {
  type: '@chat/retrieveUserList'
  payload: SbUser[]
  meta: {
    channel: string
  }
  error?: false
}

export interface RetrieveUserListFailure extends BaseFetchFailure<'@chat/retrieveUserList'> {
  meta: {
    channel: string
  }
}

/**
 * Get the specific user's profile in a particular chat channel.
 */
export interface GetChatUserProfile {
  type: '@chat/getChatUserProfile'
  payload: GetChatUserProfileResponse
}

/**
 * Activate a particular chat channel. This is a purely client-side action which marks the channel
 * as "active", and removes the unread indicator if there is one.
 */
export interface ActivateChannel {
  type: '@chat/activateChannel'
  payload: {
    channel: string
  }
}

/**
 * Deactivate a particular chat channel. This is a purely client-side action which unloads the
 * message history of a channel and thus frees up some memory.
 */
export interface DeactivateChannel {
  type: '@chat/deactivateChannel'
  payload: {
    channel: string
  }
}

/**
 * We have joined a channel and the server has sent us some initial data.
 */
export interface InitChannel {
  type: '@chat/initChannel'
  payload: ChatInitEvent
  meta: { channel: string }
}

/**
 * A user has joined a channel we're in.
 */
export interface UpdateJoin {
  type: '@chat/updateJoin'
  payload: ChatJoinEvent
  meta: { channel: string }
}

/**
 * A user has left a channel we're in.
 */
export interface UpdateLeave {
  type: '@chat/updateLeave'
  payload: ChatLeaveEvent
  meta: { channel: string }
}

/**
 * We have left a channel.
 */
export interface UpdateLeaveSelf {
  type: '@chat/updateLeaveSelf'
  meta: { channel: string }
}

/**
 * A user has been kicked in a channel we're in.
 */
export interface UpdateKick {
  type: '@chat/updateKick'
  payload: ChatKickEvent
  meta: { channel: string }
}

/**
 * We have been kicked from a channel.
 */
export interface UpdateKickSelf {
  type: '@chat/updateKickSelf'
  meta: { channel: string }
}

/**
 * A user has been banned in a channel we're in.
 */
export interface UpdateBan {
  type: '@chat/updateBan'
  payload: ChatBanEvent
  meta: { channel: string }
}

/**
 * We have been banned from a channel.
 */
export interface UpdateBanSelf {
  type: '@chat/updateBanSelf'
  meta: { channel: string }
}

/**
 * A channel we're in has receieved a new text message.
 */
export interface UpdateMessage {
  type: '@chat/updateMessage'
  payload: ChatMessageEvent
  meta: { channel: string }
}

/**
 * A user in one of our chat channels has become active (non-idle and online).
 */
export interface UpdateUserActive {
  type: '@chat/updateUserActive'
  payload: ChatUserActiveEvent
  meta: { channel: string }
}

/**
 * A user in one of our chat channels has become idle (still online, but not active).
 */
export interface UpdateUserIdle {
  type: '@chat/updateUserIdle'
  payload: ChatUserIdleEvent
  meta: { channel: string }
}

/**
 * A user in one of our chat channels has gone offline.
 */
export interface UpdateUserOffline {
  type: '@chat/updateUserOffline'
  payload: ChatUserOfflineEvent
  meta: { channel: string }
}

/**
 * Our permissions in one of the chat channels we're in have changed.
 */
export interface UpdateSelfPermissions {
  type: '@chat/permissionsChanged'
  payload: ChatPermissionsChangedEvent
  meta: { channel: string }
}
