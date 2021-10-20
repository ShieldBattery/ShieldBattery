import { Record } from 'immutable'
import { ChatMessage } from '../../common/chat'
import { SbUserId } from '../../common/users/user-info'
import { LobbyMessage } from '../lobbies/lobby-message-records'
import { PartyMessage } from '../parties/party-message-records'

/**
 * A common message type that's used in all messaging-related services (e.g. chat, whispers,
 * lobbies, parties, etc.). All other message types that are specific to a particular service are
 * defined in their respective folders.
 */
export enum CommonMessageType {
  TextMessage = 'message',
  NewDayMessage = 'newDayMessage',
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
    type: CommonMessageType.TextMessage as typeof CommonMessageType.TextMessage,
    time: 0,
    from: 0 as SbUserId,
    text: '',
    isHighlighted: false,
  })
  implements BaseMessage {}

export class NewDayMessageRecord
  extends Record({
    id: '',
    type: CommonMessageType.NewDayMessage as typeof CommonMessageType.NewDayMessage,
    time: 0,
  })
  implements BaseMessage {}

export type CommonMessage = TextMessageRecord | NewDayMessageRecord
export type Message = CommonMessage | ChatMessage | LobbyMessage | PartyMessage
