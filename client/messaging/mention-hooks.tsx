import React, { useCallback, useContext } from 'react'
import { SbUserId } from '../../common/users/sb-user'
import { MenuItemCategory } from '../users/user-context-menu'
import { ChatContext } from './chat'

/**
 * Hook that returns a function to pass as the `filterClick` method to `useUserOverlays` (or
 * things that use it, such as ConnectedUsername). The resulting method will filter any clicks that
 * should be forward to the ChatContext instead of opening a user overlay.
 */
export function useMentionFilterClick(): (userId: SbUserId, e: React.MouseEvent) => boolean {
  const chatContext = useContext(ChatContext)
  return useCallback(
    (userId, e) => {
      if (e.shiftKey) {
        chatContext.mentionUser(userId)
        e.preventDefault()
        return true
      }

      return false
    },
    [chatContext],
  )
}

/**
 * Hook that returns a function to pass as the `modifyMenuItems` method to `useUserOverlays` (or
 * things that use it, such as ConnectedUsername). The resulting method will modify menu items by
 * adding the menu item to mention users.
 */
export function useChatMenuItems(): (
  userId: SbUserId,
  items: Map<MenuItemCategory, React.ReactNode[]>,
  onMenuClose: (event?: MouseEvent) => void,
) => Map<MenuItemCategory, React.ReactNode[]> {
  const chatContext = useContext(ChatContext)
  return useCallback(
    (
      userId: SbUserId,
      items: Map<MenuItemCategory, React.ReactNode[]>,
      onMenuClose: (event?: MouseEvent) => void,
    ) => {
      return chatContext.modifyMenuItems?.(userId, items, onMenuClose) ?? items
    },
    [chatContext],
  )
}
