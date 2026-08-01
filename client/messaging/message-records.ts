import { ChatMessage } from '../../common/chat'
import { DraftChatMessage } from '../../common/matchmaking'
import { SbUserId } from '../../common/users/sb-user-id'
import { LobbyMessage } from '../lobbies/lobby-message-records'
import { BaseMessage } from './base-message-record'

/**
 * A common message type that's used in all messaging-related services (e.g. chat, whispers,
 * lobbies, parties, etc.). All other message types that are specific to a particular service are
 * defined in their respective folders.
 */
export enum CommonMessageType {
  TextMessage = 'message',
  NewDayMessage = 'newDayMessage',
}

export interface CommonTextMessage extends BaseMessage {
  readonly type: CommonMessageType.TextMessage
  readonly from: SbUserId
  readonly text: string
}

export interface CommonNewDayMessage extends BaseMessage {
  readonly type: CommonMessageType.NewDayMessage
}

export type CommonMessage = CommonTextMessage | CommonNewDayMessage
export type SbMessage = CommonMessage | ChatMessage | LobbyMessage | DraftChatMessage
