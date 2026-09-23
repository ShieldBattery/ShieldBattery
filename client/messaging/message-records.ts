import * as React from 'react'
import { ChatMessage, ServerChatMessageType } from '../../common/chat'
import { DraftChatMessage } from '../../common/matchmaking'
import { RolledOutcome } from '../../common/rolled-outcomes'
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
  WhisperEcho = 'whisperEcho',
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
  /**
   * Present on an action line announcing something the server settled for the user (a roll, a coin
   * flip, an 8-ball answer, a unit quote); the line's wording is composed from it, and `text`
   * holds only the words the user typed.
   */
  readonly outcome?: RolledOutcome
}

export interface CommonNewDayMessage extends BaseMessage {
  readonly type: CommonMessageType.NewDayMessage
}

/**
 * A line only this user sees: the answer to, or the error from, a chat command they ran. Never sent
 * to or stored on the server, so `time` is a placement hint among the loaded messages rather than
 * anything the server recorded.
 */
export interface CommonLocalLineMessage extends BaseMessage {
  readonly type: CommonMessageType.LocalLine
  readonly kind: LocalLineKind
  readonly content: React.ReactNode
}

/**
 * A whisper shown in a surface other than its own conversation, so the user sees it (and can
 * answer it) without leaving what they were doing. `time` is when the server recorded the whisper:
 * the same clock every message in the surface this is shown in is stamped from, and what the line
 * itself shows. The whisper is stored in its own conversation, never in this one.
 */
export interface CommonWhisperEchoMessage extends BaseMessage {
  readonly type: CommonMessageType.WhisperEcho
  readonly direction: 'incoming' | 'outgoing'
  readonly counterpartId: SbUserId
  readonly text: string
  readonly emote?: boolean
  /**
   * Present on an action line announcing something the server settled for the user (a roll, a coin
   * flip, an 8-ball answer, a unit quote); the line's wording is composed from it, and `text`
   * holds only the words the user typed.
   */
  readonly outcome?: RolledOutcome
}

/**
 * A message the server never stored in the conversation it's shown in: it is put there by this
 * client alone and is gone on reload, like the join/leave banners a channel keeps.
 */
export type LocalMessage = CommonLocalLineMessage | CommonWhisperEchoMessage

export type CommonMessage =
  | CommonTextMessage
  | CommonNewDayMessage
  | CommonLocalLineMessage
  | CommonWhisperEchoMessage
export type SbMessage = CommonMessage | ChatMessage | LobbyMessage | DraftChatMessage

const SERVER_ORIGIN_MESSAGE_TYPES: ReadonlySet<string> = new Set<string>([
  // Chat messages the server persists. The client-only chat message types are deliberately absent.
  ...Object.values(ServerChatMessageType),
  // Text messages that arrive from the server but get stored as the common type (whispers), plus
  // the lobby and draft text messages that share this type's value. All of them carry a
  // server-recorded time.
  CommonMessageType.TextMessage,
  // `CommonLocalLineMessage` and `CommonWhisperEchoMessage` are deliberately absent, even though an
  // echo's `time` does come from the server: the conversation they're shown in is not the one the
  // server stored them in (a command's output it stored nowhere at all), so a history cursor
  // anchored on one would ask the server for a message it has no record of there, and a read
  // position advanced over one would count a whisper read in a channel, or a command's answer read
  // as if it were someone's message.
])

/**
 * Returns whether a message is one the server stored in this conversation, i.e. its `time` can be
 * compared against times the server hands out (such as a read position) and handed back as a
 * history cursor. Messages the client puts in a conversation itself (join/leave banners, the
 * synthesized day dividers, the lines chat commands answer with, whispers echoed from another
 * conversation) are not.
 */
export function isServerOriginMessage(message: SbMessage): boolean {
  return SERVER_ORIGIN_MESSAGE_TYPES.has(message.type)
}
