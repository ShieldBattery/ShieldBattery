import * as React from 'react'
import { SbUserId } from '../../common/users/sb-user-id'
import { UserMenuComponent } from '../users/user-context-menu'

/**
 * Props passed to the component that customizes/displays context menu items for a message within
 * a chat area.
 */
export interface MessageMenuProps {
  /** The message this context menu is for. */
  messageId: string
  /**
   * The base items in the context menu. All of these items should be displayed to the user, but
   * more can be added as well.
   */
  items: ReadonlyArray<React.ReactNode>
  /**
   * An event handler that will be called when the menu closes.
   */
  onMenuClose: (event?: MouseEvent) => void

  /**
   * Component type to use to render the menu items in the `MessageMenuItemsComponent`.
   */
  MenuComponent: React.ComponentType<{
    items: ReadonlyArray<React.ReactNode>
    messageId: string
    onMenuClose: (event?: MouseEvent) => void
  }>
}

export type MessageMenuComponent = React.ComponentType<MessageMenuProps>

export function DefaultMessageMenu({
  items,
  MenuComponent,
  messageId,
  onMenuClose,
}: MessageMenuProps) {
  return <MenuComponent items={items} messageId={messageId} onMenuClose={onMenuClose} />
}

export interface ChatContextValue {
  /** Callback called when the user requests to mention a particular user in chat. */
  mentionUser?: (userId: SbUserId) => void
  /** Component that will display and customize context menu items for users. */
  UserMenu?: UserMenuComponent
  /** Component that will display and customize context menu items for messages. */
  MessageMenu: MessageMenuComponent
}

export const ChatContext = React.createContext<ChatContextValue>({
  mentionUser: () => {},
  MessageMenu: DefaultMessageMenu,
})

export interface MessageMenuContextValue {
  messageId: string
  onMenuClose: (event?: MouseEvent) => void
}

export const MessageMenuContext = React.createContext<MessageMenuContextValue>({
  messageId: '',
  onMenuClose: () => {},
})
