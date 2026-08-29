import { TFunction } from 'i18next'
import { assertUnreachable } from './assert-unreachable'
import { BasicChannelInfo, SbChannelId } from './chat'
import { SbUser } from './users/sb-user'
import { SbUserId } from './users/sb-user-id'

export enum WhisperMessageType {
  TextMessage = 'message',
}

export interface BaseWhisperMessage {
  id: string
  type: WhisperMessageType
  /**
   * The ID of the user that sent the message. Full user info is delivered separately via the
   * `users` array on the containing event/response.
   */
  from: SbUserId
  /** The ID of the user that received the message. See `from` for where to find full user info. */
  to: SbUserId
  time: number
}

/** A common text message that was sent from one user to another. */
export interface WhisperTextMessage extends BaseWhisperMessage {
  type: typeof WhisperMessageType.TextMessage
  text: string
}

export type WhisperMessage = WhisperTextMessage

export interface WhisperSessionInitEvent {
  action: 'initSession3'
  target: SbUserId
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
  mentions: SbUser[]
  /** Basic channel data for all channels that were mentioned in the message, if any. */
  channelMentions: BasicChannelInfo[]
}

export type WhisperEvent = WhisperSessionInitEvent | WhisperSessionCloseEvent | WhisperMessageEvent

export interface WhisperReadTimeChangedEvent {
  action: 'lastReadTimeChanged'
  /** The other user in the conversation whose read position this is for. */
  target: SbUserId
  /** Epoch ms of this user's server-recorded read position in the conversation. */
  lastReadTime: number
}

/** Events published to a single user (all of their sessions) rather than to a conversation. */
export type WhisperUserEvent = WhisperReadTimeChangedEvent

export interface SendWhisperMessageRequest {
  message: string
}

/**
 * The body data of the API route for reporting a user's read position in a whisper conversation.
 */
export interface MarkWhisperReadRequest {
  /** Epoch ms of the newest message the user has seen in the conversation. */
  lastReadTime: number
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
  /** A list of basic channel data for all channels that were mentioned in the messages, if any. */
  channelMentions: BasicChannelInfo[]
  /** A list of channel IDs saved in various whisper messages that no longer exist. */
  deletedChannels: SbChannelId[]
}

export enum WhisperServiceErrorCode {
  UserNotFound = 'userNotFound',
  NoSelfMessaging = 'noSelfMessaging',
  InvalidGetSessionHistoryAction = 'invalidGetSessionHistoryAction',
  UserChatRestricted = 'userChatRestricted',
}

const ALL_WHISPER_SERVICE_ERROR_CODES: ReadonlyArray<WhisperServiceErrorCode> =
  Object.values(WhisperServiceErrorCode)

function isWhisperServiceErrorCode(code: string): code is WhisperServiceErrorCode {
  return ALL_WHISPER_SERVICE_ERROR_CODES.includes(code as WhisperServiceErrorCode)
}

export function whisperServiceErrorToString(
  code: WhisperServiceErrorCode | string | undefined,
  t: TFunction,
): string {
  if (code !== undefined && isWhisperServiceErrorCode(code)) {
    switch (code) {
      case WhisperServiceErrorCode.UserNotFound:
        return t('whispers.errors.userNotFound', 'User not found')
      case WhisperServiceErrorCode.NoSelfMessaging:
        return t('whispers.errors.noSelfMessaging', 'Cannot send messages to yourself')
      case WhisperServiceErrorCode.InvalidGetSessionHistoryAction:
        return t(
          'whispers.errors.invalidAction',
          'Must have an active whisper session with a user to retrieve message history',
        )
      case WhisperServiceErrorCode.UserChatRestricted:
        return t(
          'whispers.errors.userChatRestricted',
          'You are currently restricted from sending chat messages',
        )
      default:
        return assertUnreachable(code)
    }
  } else {
    return t('whispers.errors.unknownError', 'Unknown error')
  }
}

export interface GetWhisperSessionsResponse {
  sessions: SbUserId[]
  users: SbUser[]
  /**
   * IDs of the target users whose conversations have messages newer than the user's last recorded
   * read position. A session whose target ID is absent from this list should not be treated as
   * unread. Additive over the base response so older clients ignore it.
   */
  unreadSessions?: SbUserId[]
  /**
   * Epoch millis of the user's last recorded read position for each whisper session that has one.
   * A session whose target ID is absent from this list has no recorded read position. Additive
   * over the base response so older clients ignore it.
   */
  lastReadTimes?: Array<{ targetId: SbUserId; lastReadTime: number }>
}
