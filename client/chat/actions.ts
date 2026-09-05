import {
  ChatBanEvent,
  ChatInitActiveUsersEvent,
  ChatInitEvent,
  ChatJoinEvent,
  ChatKickEvent,
  ChatLeaveEvent,
  ChatMessageDeletedEvent,
  ChatMessageEvent,
  ChatOwnerChangedEvent,
  ChatPermissionsChangedEvent,
  ChatPreferencesChangedEvent,
  ChatUserActiveEvent,
  ChatUserIdleEvent,
  ChatUserOfflineEvent,
  ChatUserProfileChangedEvent,
  GetBatchedChannelInfosResponse,
  GetChannelHistoryServerResponse,
  GetChannelInfoResponse,
  GetChatUserProfileResponse,
  InitialChannelData,
  SbChannelId,
  SearchChannelsResponse,
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
  | LoadNewerMessagesBegin
  | LoadNewerMessages
  | LoadNewerMessagesFailure
  | LoadMessagesAroundBegin
  | LoadMessagesAround
  | LoadMessagesAroundFailure
  | ResetMessageWindow
  | RetrieveUserListBegin
  | RetrieveUserList
  | RetrieveUserListFailure
  | GetChatUserProfile
  | GetChannelInfo
  | GetBatchChannelInfoSuccess
  | GetBatchChannelInfoFailure
  | GetJoinedChannels
  | SearchChannels
  | ActivateChannel
  | DeactivateChannel
  | UpdateChannelAtBottom
  | UpdateLastReadTime
  | InitChannel
  | InitActiveUsers
  | UpdateJoin
  | UpdateLeave
  | UpdateLeaveSelf
  | UpdateKick
  | UpdateKickSelf
  | UpdateBan
  | UpdateBanSelf
  | UpdateChannelOwner
  | UpdateMessage
  | UpdateMessageDeleted
  | UpdateUserActive
  | UpdateUserIdle
  | UpdateUserOffline
  | UpdateSelfPreferences
  | UpdateSelfPermissions
  | UpdateUserProfile

export interface GetJoinedChannels {
  type: '@chat/getJoinedChannels'
  payload: InitialChannelData[]
}

export interface JoinChannelBegin {
  type: '@chat/joinChannelBegin'
  payload: {
    channelId: SbChannelId
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
    channelId: SbChannelId
  }
  error?: false
}

export interface JoinChannelFailure extends BaseFetchFailure<'@chat/joinChannel'> {
  meta: {
    channelId: SbChannelId
  }
}

export interface LeaveChannelBegin {
  type: '@chat/leaveChannelBegin'
  payload: {
    channelId: SbChannelId
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
    channelId: SbChannelId
  }
  error?: false
}

export interface LeaveChannelFailure extends BaseFetchFailure<'@chat/leaveChannel'> {
  meta: {
    channelId: SbChannelId
  }
}

export interface SendMessageBegin {
  type: '@chat/sendMessageBegin'
  payload: {
    channelId: SbChannelId
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
    channelId: SbChannelId
    message: string
  }
  error?: false
}

export interface SendMessageFailure extends BaseFetchFailure<'@chat/sendMessage'> {
  meta: {
    channelId: SbChannelId
    message: string
  }
}

export interface LoadMessageHistoryBegin {
  type: '@chat/loadMessageHistoryBegin'
  payload: {
    channelId: SbChannelId
    limit: number
    beforeTime: number
    /**
     * The generation of the loaded message window this page was requested for. The reducer drops
     * pages whose generation no longer matches the channel's, since a window that has since been
     * replaced or dropped shares no boundary with them.
     */
    windowGen: number
  }
}

/**
 * Loads the `limit` amount of messages in a chat channel before a particular time.
 */
export interface LoadMessageHistory {
  type: '@chat/loadMessageHistory'
  payload: GetChannelHistoryServerResponse
  meta: {
    channelId: SbChannelId
    limit: number
    beforeTime: number
    windowGen: number
  }
  error?: false
}

export interface LoadMessageHistoryFailure extends BaseFetchFailure<'@chat/loadMessageHistory'> {
  meta: {
    channelId: SbChannelId
    limit: number
    beforeTime: number
    windowGen: number
  }
}

export interface LoadNewerMessagesBegin {
  type: '@chat/loadNewerMessagesBegin'
  payload: {
    channelId: SbChannelId
    limit: number
    afterTime: number
    windowGen: number
    /**
     * The newest server-recorded message time (epoch ms) this client knew existed when the request
     * was dispatched, whether loaded or only observed live. Responses that report nothing newer are
     * authoritative for messages known this early — the server announces messages only after
     * storing them — so their absence proves deletion rather than a race.
     */
    knownNewestTime: number
  }
}

/**
 * Loads the `limit` oldest messages in a chat channel that are newer than a particular time,
 * extending a loaded window that sits behind the present toward it.
 */
export interface LoadNewerMessages {
  type: '@chat/loadNewerMessages'
  payload: GetChannelHistoryServerResponse
  meta: {
    channelId: SbChannelId
    limit: number
    afterTime: number
    windowGen: number
    /**
     * The newest server-recorded message time (epoch ms) this client knew existed when the request
     * was dispatched, whether loaded or only observed live. Responses that report nothing newer are
     * authoritative for messages known this early — the server announces messages only after
     * storing them — so their absence proves deletion rather than a race.
     */
    knownNewestTime: number
  }
  error?: false
}

export interface LoadNewerMessagesFailure extends BaseFetchFailure<'@chat/loadNewerMessages'> {
  meta: {
    channelId: SbChannelId
    limit: number
    afterTime: number
    windowGen: number
    /**
     * The newest server-recorded message time (epoch ms) this client knew existed when the request
     * was dispatched, whether loaded or only observed live. Responses that report nothing newer are
     * authoritative for messages known this early — the server announces messages only after
     * storing them — so their absence proves deletion rather than a race.
     */
    knownNewestTime: number
  }
}

export interface LoadMessagesAroundBegin {
  type: '@chat/loadMessagesAroundBegin'
  payload: {
    channelId: SbChannelId
    limit: number
    /** The time the window was asked for around, when the request named a time. */
    aroundTime?: number
    /** The message the window was asked for around, when the request named a message. */
    aroundMessageId?: string
    windowGen: number
    /**
     * The newest server-recorded message time (epoch ms) this client knew existed when the request
     * was dispatched, whether loaded or only observed live, or `undefined` when it knew of none.
     * Responses that report nothing newer are authoritative for messages known this early — the
     * server announces messages only after storing them — so their absence proves deletion rather
     * than a race.
     */
    knownNewestTime: number | undefined
  }
}

/**
 * Loads a window of up to `limit` messages in a chat channel centered on a particular point in its
 * history, named either by time or by one of its messages. The result replaces whatever was loaded
 * for the channel, since the fetched range doesn't have to touch it.
 */
export interface LoadMessagesAround {
  type: '@chat/loadMessagesAround'
  payload: GetChannelHistoryServerResponse
  meta: {
    channelId: SbChannelId
    limit: number
    /** The time the window was asked for around, when the request named a time. */
    aroundTime?: number
    /** The message the window was asked for around, when the request named a message. */
    aroundMessageId?: string
    windowGen: number
    /**
     * The newest server-recorded message time (epoch ms) this client knew existed when the request
     * was dispatched, whether loaded or only observed live, or `undefined` when it knew of none.
     * Responses that report nothing newer are authoritative for messages known this early — the
     * server announces messages only after storing them — so their absence proves deletion rather
     * than a race.
     */
    knownNewestTime: number | undefined
  }
  error?: false
}

export interface LoadMessagesAroundFailure extends BaseFetchFailure<'@chat/loadMessagesAround'> {
  meta: {
    channelId: SbChannelId
    limit: number
    /** The time the window was asked for around, when the request named a time. */
    aroundTime?: number
    /** The message the window was asked for around, when the request named a message. */
    aroundMessageId?: string
    windowGen: number
    /**
     * The newest server-recorded message time (epoch ms) this client knew existed when the request
     * was dispatched, whether loaded or only observed live, or `undefined` when it knew of none.
     * Responses that report nothing newer are authoritative for messages known this early — the
     * server announces messages only after storing them — so their absence proves deletion rather
     * than a race.
     */
    knownNewestTime: number | undefined
  }
}

/**
 * Discard everything loaded for a chat channel, returning it to the state a freshly-joined channel
 * is in: nothing loaded, older history assumed to exist, and attached to the present so live
 * messages append again.
 */
export interface ResetMessageWindow {
  type: '@chat/resetMessageWindow'
  payload: {
    channelId: SbChannelId
  }
}

export interface RetrieveUserListBegin {
  type: '@chat/retrieveUserListBegin'
  payload: {
    channelId: SbChannelId
  }
}

/**
 * Retrieve the full list of users in a particular channel.
 */
export interface RetrieveUserList {
  type: '@chat/retrieveUserList'
  payload: SbUser[]
  meta: {
    channelId: SbChannelId
  }
  error?: false
}

export interface RetrieveUserListFailure extends BaseFetchFailure<'@chat/retrieveUserList'> {
  meta: {
    channelId: SbChannelId
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
 * Get the information for a specific channel. Includes joined data if the user is in the channel.
 */
export interface GetChannelInfo {
  type: '@chat/getChannelInfo'
  payload: GetChannelInfoResponse
  meta: { channelId: SbChannelId }
}

/**
 * The server returned a response to our request for channel info about one or more channels.
 */
export interface GetBatchChannelInfoSuccess {
  type: '@chat/getBatchChannelInfo'
  payload: GetBatchedChannelInfosResponse
  error?: false
}

export type GetBatchChannelInfoFailure = BaseFetchFailure<'@chat/getBatchChannelInfo'>

/**
 * The server returned a response to our request for channel search.
 */
export interface SearchChannels {
  type: '@chat/searchChannels'
  payload: SearchChannelsResponse
}

/**
 * Activate a particular chat channel. This is a purely client-side action which marks the channel
 * as "active", and removes the unread indicator if there is one. The message list reports the
 * at-bottom state it opened in (`UpdateChannelAtBottom`) ahead of this being dispatched, so the
 * reducer reads the current flag to tell an open at the newest messages from one restoring a
 * position further back.
 */
export interface ActivateChannel {
  type: '@chat/activateChannel'
  payload: {
    channelId: SbChannelId
  }
}

/**
 * Deactivate a particular chat channel. This is a purely client-side action which unloads the
 * message history of a channel and thus frees up some memory.
 */
export interface DeactivateChannel {
  type: '@chat/deactivateChannel'
  payload: {
    channelId: SbChannelId
  }
}

/**
 * Update whether a viewed chat channel's message list is scrolled to the bottom. This is a purely
 * client-side action; the reducer uses it to trim message history down to the same cap applied to
 * inactive channels, since removing old messages while pinned to the bottom is invisible to the
 * user (auto-scroll keeps the view at the newest message).
 */
export interface UpdateChannelAtBottom {
  type: '@chat/updateChannelAtBottom'
  payload: {
    channelId: SbChannelId
    atBottom: boolean
  }
}

/**
 * The client's read position for a chat channel has advanced. Dispatched optimistically when this
 * session reports a mark-read, and by the socket handler when the server relays a read position
 * update from one of the user's other sessions.
 */
export interface UpdateLastReadTime {
  type: '@chat/updateLastReadTime'
  payload: {
    channelId: SbChannelId
    lastReadTime: number
  }
}

/**
 * We have joined a channel and the server has sent us some initial data.
 */
export interface InitChannel {
  type: '@chat/initChannel'
  payload: ChatInitEvent
  meta: { channelId: SbChannelId }
}

/**
 * A user has joined a channel we're in.
 */
export interface UpdateJoin {
  type: '@chat/updateJoin'
  payload: ChatJoinEvent
  meta: {
    channelId: SbChannelId
    /** Whether the app window was focused when this arrived. See `UpdateMessage`. */
    windowFocused: boolean
  }
}

/**
 * A user has left a channel we're in.
 */
export interface UpdateLeave {
  type: '@chat/updateLeave'
  payload: ChatLeaveEvent
  meta: {
    channelId: SbChannelId
    /** Whether the app window was focused when this arrived. See `UpdateMessage`. */
    windowFocused: boolean
  }
}

/**
 * We have left a channel.
 */
export interface UpdateLeaveSelf {
  type: '@chat/updateLeaveSelf'
  meta: { channelId: SbChannelId }
}

/**
 * A user has been kicked in a channel we're in.
 */
export interface UpdateKick {
  type: '@chat/updateKick'
  payload: ChatKickEvent
  meta: {
    channelId: SbChannelId
    /** Whether the app window was focused when this arrived. See `UpdateMessage`. */
    windowFocused: boolean
  }
}

/**
 * We have been kicked from a channel.
 */
export interface UpdateKickSelf {
  type: '@chat/updateKickSelf'
  meta: { channelId: SbChannelId }
}

/**
 * A user has been banned in a channel we're in.
 */
export interface UpdateBan {
  type: '@chat/updateBan'
  payload: ChatBanEvent
  meta: {
    channelId: SbChannelId
    /** Whether the app window was focused when this arrived. See `UpdateMessage`. */
    windowFocused: boolean
  }
}

/**
 * We have been banned from a channel.
 */
export interface UpdateBanSelf {
  type: '@chat/updateBanSelf'
  meta: { channelId: SbChannelId }
}

/**
 * A channel we're in has a new owner.
 */
export interface UpdateChannelOwner {
  type: '@chat/ownerChanged'
  payload: ChatOwnerChangedEvent
  meta: {
    channelId: SbChannelId
    /** Whether the app window was focused when this arrived. See `UpdateMessage`. */
    windowFocused: boolean
  }
}

/**
 * A channel we're in has receieved a new text message.
 */
export interface UpdateMessage {
  type: '@chat/updateMessage'
  payload: ChatMessageEvent
  meta: {
    channelId: SbChannelId
    /**
     * Whether a message from another user mentions the current user and wasn't sent by someone
     * they've blocked.
     */
    mentionsSelf: boolean
    /**
     * Whether the current user authored the message. Self-authored messages do not create unread
     * state.
     */
    isSelfMessage: boolean
    /**
     * Whether the app window was focused when the live event arrived. A non-self message landing
     * in an unfocused window can't have been seen no matter where the channel's view is scrolled,
     * so the reducer counts it as unread regardless.
     */
    windowFocused: boolean
  }
}

/**
 * A message was deleted in a channel we're in.
 */
export interface UpdateMessageDeleted {
  type: '@chat/updateMessageDeleted'
  payload: ChatMessageDeletedEvent
  meta: { channelId: SbChannelId }
}

export interface InitActiveUsers {
  type: '@chat/initActiveUsers'
  payload: ChatInitActiveUsersEvent
  meta: { channelId: SbChannelId }
}

/**
 * A user in one of our chat channels has become active (non-idle and online).
 */
export interface UpdateUserActive {
  type: '@chat/updateUserActive'
  payload: ChatUserActiveEvent
  meta: { channelId: SbChannelId }
}

/**
 * A user in one of our chat channels has become idle (still online, but not active).
 */
export interface UpdateUserIdle {
  type: '@chat/updateUserIdle'
  payload: ChatUserIdleEvent
  meta: { channelId: SbChannelId }
}

/**
 * A user in one of our chat channels has gone offline.
 */
export interface UpdateUserOffline {
  type: '@chat/updateUserOffline'
  payload: ChatUserOfflineEvent
  meta: { channelId: SbChannelId }
}

/**
 * Our preferences in one of the chat channels we're in have changed.
 */
export interface UpdateSelfPreferences {
  type: '@chat/preferencesChanged'
  payload: ChatPreferencesChangedEvent
  meta: { channelId: SbChannelId }
}

/**
 * Our permissions in one of the chat channels we're in have changed.
 */
export interface UpdateSelfPermissions {
  type: '@chat/permissionsChanged'
  payload: ChatPermissionsChangedEvent
  meta: { channelId: SbChannelId }
}

/**
 * A user's profile (isModerator status) in one of the chat channels we're in has changed.
 */
export interface UpdateUserProfile {
  type: '@chat/userProfileChanged'
  payload: ChatUserProfileChangedEvent
  meta: { channelId: SbChannelId }
}
