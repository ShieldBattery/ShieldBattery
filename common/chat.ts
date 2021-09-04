import { SbUser, SbUserId } from './users/user-info'

export enum ChatMessageType {
  TextMessage = 'message',
}

export interface BaseChatMessageData {
  readonly type: ChatMessageType
}

export interface ChatTextMessageData extends BaseChatMessageData {
  type: typeof ChatMessageType.TextMessage
  text: string
}

export type ChatMessageData = ChatTextMessageData

export interface ChatMessage {
  id: string
  user: ChatUser
  sent: number
  data: ChatMessageData
}

// TODO(2Pac): Include more information here, e.g. channel permissions, join date, etc.
export interface ChatUser {
  id: SbUserId
  name: string
}

export interface ChatInitEvent {
  action: 'init'
  /** A list of active users that are in the chat channel. */
  activeUsers: ChatUser[]
}

export interface ChatJoinEvent {
  action: 'join'
  /** A user that has joined the chat channel. */
  channelUser: ChatUser
  /** A user info for the channel user that was returned in the `channelUser` property. */
  user: SbUser
}

export interface ChatLeaveEvent {
  action: 'leave'
  /** A user that has left the chat channel. */
  user: ChatUser
  /** A user that was selected as a new owner of the channel, if any. */
  newOwner: ChatUser | null
}

export interface ChatMessageEvent extends ChatMessage {
  action: 'message'
}

export interface ChatUserActiveEvent {
  action: 'userActive'
  user: ChatUser
}

export interface ChatUserIdleEvent {
  action: 'userIdle'
  user: ChatUser
}

export interface ChatUserOfflineEvent {
  action: 'userOffline'
  user: ChatUser
}

export type ChatEvent =
  | ChatInitEvent
  | ChatJoinEvent
  | ChatLeaveEvent
  | ChatMessageEvent
  | ChatUserActiveEvent
  | ChatUserIdleEvent
  | ChatUserOfflineEvent

export interface SendChatMessageServerBody {
  message: string
}

/**
 * Payload returned for a request to retrieve the users in a chat channel.
 */
export interface GetChannelUsersServerPayload {
  /** A list of the users that are in the chat channel. */
  channelUsers: ChatUser[]
  /** A list of user infos for channel users that are in the returned `channelUsers` list. */
  users: SbUser[]
}
