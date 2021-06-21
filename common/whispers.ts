import { User } from './users/user-info'

export enum WhisperMessageType {
  TextMessage = 'message',
}

export interface BaseWhisperMessageData {
  readonly type: WhisperMessageType
}

export interface WhisperTextMessageData extends BaseWhisperMessageData {
  type: typeof WhisperMessageType.TextMessage
  text: string
}

export type WhisperMessageData = WhisperTextMessageData

export interface WhisperMessage {
  id: string
  from: User
  to: User
  sent: number
  data: WhisperMessageData
}

export enum WhisperUserStatus {
  Active = 'active',
  Idle = 'idle',
  Offline = 'offline',
}

export interface WhisperSessionInitEvent {
  action: 'initSession'
  target: User
  targetStatus: WhisperUserStatus
}

export interface WhisperSessionCloseEvent {
  action: 'closeSession'
  target: User
}

export interface WhisperMessageUpdateEvent {
  action: 'message'
  /** A whisper message that was received. */
  message: WhisperMessage
  /** A list of user infos participating in the received message. */
  users: User[]
}

export interface WhisperUserActiveEvent {
  action: 'userActive'
  target: User
}

export interface WhisperUserIdleEvent {
  action: 'userIdle'
  target: User
}

export interface WhisperUserOfflineEvent {
  action: 'userOffline'
  target: User
}

export type WhisperEvent =
  | WhisperSessionInitEvent
  | WhisperSessionCloseEvent
  | WhisperMessageUpdateEvent
  | WhisperUserActiveEvent
  | WhisperUserIdleEvent
  | WhisperUserOfflineEvent

export interface SendWhisperMessageServerBody {
  message: string
}

/**
 * Payload returned for a request to retrieve the session history.
 */
export interface GetSessionHistoryServerPayload {
  /**
   * A list of messages for a particular whisper session. Note that this payload is paginated so not
   * all of the messages are returned at once.
   */
  messages: WhisperMessage[]
  /** A list of user infos participating in this whisper session. */
  users: User[]
}
