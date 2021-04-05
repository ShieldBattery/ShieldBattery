import { Record } from 'immutable'
import { ChatMessage } from '../chat/chat-message-records'
import { LobbyMessage } from '../lobbies/lobby-message-records'

/**
 * NOTE(2Pac): A common message type that's used in all messaging-related services (e.g. chat,
 * whispers, lobbies, parties, etc.). For now that's only a default text message, but there might be
 * more in the future. All other message types that are specific to a particular service are defined
 * in their respective folders.
 */
export enum CommonMessageType {
  TextMessage = 'message',
}

/**
 * The base fields for all messages. Any added messages should implement this.
 */
export interface BaseMessage {
  readonly id: string
  readonly type: string
  readonly time: number
}

// TODO(tec27): Write a function or something to declare just the extra parts + do the correct
// typing of the type field automatically.
export class TextMessageRecord
  extends Record({
    id: '',
    type: CommonMessageType.TextMessage,
    time: 0,
    from: '',
    text: '',
  })
  implements BaseMessage {}

export type CommonMessage = TextMessageRecord
export type Message = CommonMessage | ChatMessage | LobbyMessage
