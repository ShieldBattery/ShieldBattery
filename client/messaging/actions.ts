import { BasicChannelInfo } from '../../common/chat'
import { SbUser } from '../../common/users/sb-user'
import { LocalMessageTarget } from './local-message-target'
import { LocalMessage } from './message-records'

export type MessagingActions = LoadChatMentions | AppendLocalMessage

/**
 * A common action for loading user and channel mentions from chat messages across all chat
 * services (chat channels, lobbies, whispers, draft chat, etc.).
 */
export interface LoadChatMentions {
  type: '@messaging/loadMentions'
  payload: {
    /** Users mentioned in the chat message */
    mentions: SbUser[]
    /** Channels mentioned in the chat message */
    channelMentions: BasicChannelInfo[]
  }
}

/**
 * Puts a message only this user sees at the end of one conversation's message list. Every chat
 * surface's reducer handles this and ignores the targets that aren't its own, since which store the
 * message belongs in is the only thing that differs between them.
 */
export interface AppendLocalMessage {
  type: '@messaging/appendLocalMessage'
  payload: {
    target: LocalMessageTarget
    message: LocalMessage
  }
}
