import { TFunction } from 'i18next'
import { assertUnreachable } from './assert-unreachable'
import { BasicChannelInfo, SbChannelId } from './chat'
import { RolledOutcome } from './rolled-outcomes'
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
  /**
   * Present and `true` for an action line the user sent with `/me`, which renders as
   * `* Name action` instead of `Name: text`. Never carried as `false`.
   */
  emote?: boolean
  /**
   * Present on an action line announcing something the server settled for the user (a roll, a coin
   * flip, an 8-ball answer, a unit quote). Only the server puts it there; the message endpoints
   * refuse it.
   */
  outcome?: RolledOutcome
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
  /**
   * Present and `true` for an action line the user sent with `/me`, which renders as
   * `* Name action` instead of `Name: text`. Never carried as `false`.
   */
  emote?: boolean
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
  /**
   * Whether messages older than the returned window exist. For requests with `afterTime`, this is
   * always true (the cursor implies the client already holds older messages).
   */
  hasMoreBefore: boolean
  /**
   * Whether messages newer than the returned window existed when the query executed. For requests
   * with `beforeTime`, this is always true (the cursor implies the client already holds newer
   * messages); for requests with no cursor (a newest-page fetch), it is always false.
   */
  hasMoreAfter: boolean
}

export enum WhisperServiceErrorCode {
  UserNotFound = 'userNotFound',
  NoSelfMessaging = 'noSelfMessaging',
  InvalidGetSessionHistoryAction = 'invalidGetSessionHistoryAction',
  UserChatRestricted = 'userChatRestricted',
  MessageNotFound = 'messageNotFound',
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
      case WhisperServiceErrorCode.MessageNotFound:
        return t(
          'whispers.errors.messageNotFound',
          "That message couldn't be found in this whisper.",
        )
      default:
        return assertUnreachable(code)
    }
  } else {
    return t('whispers.errors.unknownError', 'Unknown error')
  }
}

/** Response to resolving a whisper message link: which whisper the message belongs to, from the requester's side. */
export interface GetWhisperMessageLinkResponse {
  /** The other participant of the whisper the message is in. */
  targetId: SbUserId
  /** The target's user info, so the client can build the whisper URL. */
  users: SbUser[]
}

export interface GetWhisperSessionsResponse {
  sessions: SbUserId[]
  users: SbUser[]
  /**
   * The user's read position for each whisper session, and how far past it that conversation's
   * unread messages run. Every session is listed. Additive over the base response so older clients
   * ignore it.
   *
   * `lastReadTime` is their last recorded read position, or one millisecond before the session's
   * start date if they've never recorded one. `latestUnreadTime` is the newest incoming message
   * sitting past that position, and is omitted when there is none, which is what marks the session
   * read.
   *
   * The unread extent is a time rather than a flag: a client holding nothing but this response has
   * no messages to measure a read position against, so a flag would leave it unable to tell a read
   * position that covers the whole unread backlog from one that covers only part of it, and it
   * would have to guess which way to move the badge when another of the user's sessions reads
   * partway through.
   */
  lastReadTimes?: Array<{
    targetId: SbUserId
    lastReadTime: number
    latestUnreadTime?: number
  }>
}
