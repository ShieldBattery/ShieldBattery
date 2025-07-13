import { BasicChannelInfo } from '../../common/chat'
import { SbUser } from '../../common/users/sb-user'

export type MessagingActions = LoadChatMentions

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
