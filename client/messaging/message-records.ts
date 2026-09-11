import * as React from 'react'
import { ChatMessage, ServerChatMessageType } from '../../common/chat'
import { DraftChatMessage } from '../../common/matchmaking'
import { SbUserId } from '../../common/users/sb-user-id'
import { LobbyMessage } from '../lobbies/lobby-message-records'
import { BaseMessage } from './base-message-record'
import { LocalLineKind } from './commands/local-output'

/**
 * A common message type that's used in all messaging-related services (e.g. chat, whispers,
 * lobbies, parties, etc.). All other message types that are specific to a particular service are
 * defined in their respective folders.
 */
export enum CommonMessageType {
  TextMessage = 'message',
  NewDayMessage = 'newDayMessage',
  LocalLine = 'localLine',
}

export interface CommonTextMessage extends BaseMessage {
  readonly type: CommonMessageType.TextMessage
  readonly from: SbUserId
  readonly text: string
  /**
   * Present and `true` for an action line the user sent with `/me`, which renders as
   * `* Name action` instead of `Name: text`. Never carried as `false`.
   */
  readonly emote?: boolean
}

export interface CommonNewDayMessage extends BaseMessage {
  readonly type: CommonMessageType.NewDayMessage
}

/**
 * A line only this user sees: the answer to, or the error from, a chat command they ran. These
 * live in the running session's memory only, never in a surface's message array or on the server,
 * so `time` is a placement hint among the loaded messages rather than anything the server recorded.
 */
export interface CommonLocalLineMessage extends BaseMessage {
  readonly type: CommonMessageType.LocalLine
  readonly kind: LocalLineKind
  readonly content: React.ReactNode
}

export type CommonMessage = CommonTextMessage | CommonNewDayMessage | CommonLocalLineMessage
export type SbMessage = CommonMessage | ChatMessage | LobbyMessage | DraftChatMessage

const SERVER_ORIGIN_MESSAGE_TYPES: ReadonlySet<string> = new Set<string>([
  // Chat messages the server persists. The client-only chat message types are deliberately absent.
  ...Object.values(ServerChatMessageType),
  // Text messages that arrive from the server but get stored as the common type (whispers), plus
  // the lobby and draft text messages that share this type's value. All of them carry a
  // server-recorded time.
  CommonMessageType.TextMessage,
])

/**
 * Returns whether a message's `time` is a server-recorded timestamp, i.e. it can be compared
 * against times the server hands out (such as a read position). Messages that only ever exist on
 * the client (join/leave banners, the synthesized day dividers) stamp `time` with the local clock,
 * so their times mean nothing to the server.
 */
export function isServerOriginMessage(message: SbMessage): boolean {
  return SERVER_ORIGIN_MESSAGE_TYPES.has(message.type)
}
