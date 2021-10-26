import { SbUser, SbUserId } from './users/user-info'

export enum WhisperMessageType {
  TextMessage = 'message',
}

export interface BaseWhisperMessageData {
  readonly type: WhisperMessageType
}

export interface WhisperTextMessageData extends BaseWhisperMessageData {
  type: typeof WhisperMessageType.TextMessage
  text: string
  mentions: SbUserId[]
}

export type WhisperMessageData = WhisperTextMessageData

export interface WhisperMessage {
  id: string
  from: SbUser
  to: SbUser
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
  target: SbUser
  targetStatus: WhisperUserStatus
}

export interface WhisperSessionCloseEvent {
  action: 'closeSession'
  target: SbUser
}

export interface WhisperMessageUpdateEvent {
  action: 'message'
  /** A whisper message that was received. */
  message: WhisperMessage
  /** A list of user infos participating in the received message. */
  users: SbUser[]
  /** User infos for all whisper users that were mentioned in the message, if any. */
  mentions: SbUser[]
}

export interface WhisperUserActiveEvent {
  action: 'userActive'
  target: SbUser
}

export interface WhisperUserIdleEvent {
  action: 'userIdle'
  target: SbUser
}

export interface WhisperUserOfflineEvent {
  action: 'userOffline'
  target: SbUser
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
  users: SbUser[]
  /** A list of user infos for all whisper users that were mentioned in the messagess, if any. */
  mentions: SbUser[]
}
