export enum WhisperMessageType {
  TextMessage = 'textMessage',
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
  from: WhisperUser
  to: WhisperUser
  sent: number
  data: WhisperMessageData
}

// TODO(2Pac): Make this into an interface and include more information here
export type WhisperUser = string

export enum WhisperUserStatus {
  Active = 'active',
  Idle = 'idle',
  Offline = 'offline',
}

export interface WhisperSessionInitEvent {
  action: 'initSession'
  target: WhisperUser
  targetStatus: WhisperUserStatus
}

export interface WhisperSessionCloseEvent {
  action: 'closeSession'
  target: WhisperUser
}

export interface WhisperMessageUpdateEvent extends WhisperMessage {
  action: 'message'
}

export interface WhisperUserActiveEvent {
  action: 'userActive'
  target: WhisperUser
}

export interface WhisperUserIdleEvent {
  action: 'userIdle'
  target: WhisperUser
}

export interface WhisperUserOfflineEvent {
  action: 'userOffline'
  target: WhisperUser
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
