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

// TODO(2Pac): Make this into an interface and include more information here
export type ChatUser = string

export interface ChatInitEvent {
  action: 'init'
  activeUsers: ChatUser[]
}

export interface ChatJoinEvent {
  action: 'join'
  user: ChatUser
}

export interface ChatLeaveEvent {
  action: 'leave'
  user: ChatUser
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
