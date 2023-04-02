import { assertUnreachable } from './assert-unreachable'
import { ChannelInfo } from './chat'
import { SbUser, SbUserId } from './users/sb-user'

export enum WhisperMessageType {
  TextMessage = 'message',
}

export interface BaseWhisperMessage {
  id: string
  type: WhisperMessageType
  from: SbUser
  to: SbUser
  time: number
}

/** A common text message that was sent from one user to another. */
export interface WhisperTextMessage extends BaseWhisperMessage {
  type: typeof WhisperMessageType.TextMessage
  text: string
}

export type WhisperMessage = WhisperTextMessage

export interface WhisperSessionInitEvent {
  action: 'initSession2'
  target: SbUser
}

export interface WhisperSessionCloseEvent {
  action: 'closeSession'
  target: SbUserId
}

export interface WhisperMessageEvent {
  action: 'message'
  /** A whisper message that was received. */
  message: WhisperTextMessage
  /** A list of user infos participating in the received message. */
  users: SbUser[]
  /** User infos for all whisper users that were mentioned in the message, if any. */
  userMentions: SbUser[]
  /** Channel infos for all channels that were mentioned in the message, if any. */
  channelMentions: ChannelInfo[]
}

export type WhisperEvent = WhisperSessionInitEvent | WhisperSessionCloseEvent | WhisperMessageEvent

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
  userMentions: SbUser[]
  /** A list of channel infos for all channels that were mentioned in the messages, if any. */
  channelMentions: ChannelInfo[]
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
