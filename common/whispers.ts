import { assertUnreachable } from './assert-unreachable'
import { SbUser, SbUserId } from './users/sb-user'

export enum WhisperMessageType {
  TextMessage = 'message',
}

export interface BaseWhisperMessageData {
  readonly type: WhisperMessageType
}

export interface WhisperTextMessageData extends BaseWhisperMessageData {
  type: typeof WhisperMessageType.TextMessage
  text: string
  // TODO(tec27): This should probably only be optional at the DB level, clients should see this
  // as always present (since we deal with old messages at the API layer). Need to keep separate
  // model types vs API types like in chat, though.
  mentions?: SbUserId[]
}

export type WhisperMessageData = WhisperTextMessageData

export interface WhisperMessage {
  id: string
  from: SbUser
  to: SbUser
  sent: number
  data: WhisperMessageData
}

export interface WhisperSessionInitEvent {
  action: 'initSession2'
  target: SbUser
}

export interface WhisperSessionCloseEvent {
  action: 'closeSession'
  target: SbUserId
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

export type WhisperEvent =
  | WhisperSessionInitEvent
  | WhisperSessionCloseEvent
  | WhisperMessageUpdateEvent

export interface SendWhisperMessageRequest {
  message: string
}

/**
 * Payload returned for a request to retrieve the session history.
 */
export interface GetSessionHistoryResponse {
  /**
   * A list of messages for a particular whisper session. Note that this payload is paginated so not
   * all of the messages are returned at once.
   */
  messages: WhisperMessage[]
  /** A list of user infos participating in this whisper session. */
  users: SbUser[]
  /** A list of user infos for all whisper users that were mentioned in the messages, if any. */
  mentions: SbUser[]
}

export enum WhisperServiceErrorCode {
  UserNotFound = 'userNotFound',
  NoSelfMessaging = 'noSelfMessaging',
  InvalidGetSessionHistoryAction = 'invalidGetSessionHistoryAction',
}

const ALL_WHISPER_SERVICE_ERROR_CODES: ReadonlyArray<WhisperServiceErrorCode> =
  Object.values(WhisperServiceErrorCode)

function isWhisperServiceErrorCode(code: string): code is WhisperServiceErrorCode {
  return ALL_WHISPER_SERVICE_ERROR_CODES.includes(code as WhisperServiceErrorCode)
}

export function whisperServiceErrorToString(
  code: WhisperServiceErrorCode | string | undefined,
): string {
  if (code !== undefined && isWhisperServiceErrorCode(code)) {
    switch (code) {
      case WhisperServiceErrorCode.UserNotFound:
        return 'User not found'
      case WhisperServiceErrorCode.NoSelfMessaging:
        return 'Cannot send messages to yourself'
      case WhisperServiceErrorCode.InvalidGetSessionHistoryAction:
        return 'Must have an active whisper session with a user to retrieve message history'
      default:
        return assertUnreachable(code)
    }
  } else {
    return 'Unknown error'
  }
}
