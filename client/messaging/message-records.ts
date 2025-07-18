import { Record } from 'immutable'
import { ChatMessage } from '../../common/chat'
import { DraftChatMessage } from '../../common/matchmaking'
import { SbUserId } from '../../common/users/sb-user-id'
import { LobbyMessage } from '../lobbies/lobby-message-records'
import { BaseMessage } from './base-message-record'

// TODO(2Pac): Move all the messaging-related services to immer like the chat service already is,
// and remove this file.

/**
 * A common message type that's used in all messaging-related services (e.g. chat, whispers,
 * lobbies, parties, etc.). All other message types that are specific to a particular service are
 * defined in their respective folders.
 */
export enum CommonMessageType {
  TextMessage = 'message',
  NewDayMessage = 'newDayMessage',
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
export type SbMessage = CommonMessage | ChatMessage | LobbyMessage | DraftChatMessage
