import React from 'react'
import { SbUserId } from '../../common/users/sb-user'
import { MenuItemCategory } from '../users/user-context-menu'

export interface ChatContextValue {
  mentionUser?: (userId: SbUserId) => void
  modifyUserMenuItems?: (
    userId: SbUserId,
    items: Map<MenuItemCategory, React.ReactNode[]>,
    onMenuClose: (event?: MouseEvent) => void,
  ) => Map<MenuItemCategory, React.ReactNode[]>
  modifyMessageMenuItems?: (
    messageId: string,
    items: React.ReactNode[],
    onMenuClose: (event?: MouseEvent) => void,
  ) => React.ReactNode[]
}
export const ChatContext = React.createContext<ChatContextValue>({
  mentionUser: () => {},
})
