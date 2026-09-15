import * as React from 'react'
import { SbUserId } from '../../common/users/sb-user-id'
import { UserMenuComponent } from '../users/user-context-menu'
import { DefaultMessageMenu, MessageMenuComponent } from './message-context-menu'

export interface ChatContextValue {
  /** Callback called when the user requests to mention a particular user in chat. */
  mentionUser?: (userId: SbUserId) => void
  /** Component that will display and customize context menu items for users. */
  UserMenu?: UserMenuComponent
  /** Component that will display and customize context menu items for messages. */
  MessageMenu: MessageMenuComponent
  /** If true, prevents mentions and usernames from being interactable. Defaults to false. */
  disallowMentionInteraction?: boolean
  /**
   * Id of the message the list has just been sent to by a link, if any. It's highlighted so the
   * user can tell which of the messages around it they came for; the highlight is dropped (and
   * fades out) a short while after the list arrives.
   */
  linkedMessageId?: string
}

export const ChatContext = React.createContext<ChatContextValue>({
  mentionUser: () => {},
  MessageMenu: DefaultMessageMenu,
})
