import React, { useCallback, useContext } from 'react'
import { SbUserId } from '../../common/users/sb-user'
import { MenuItem } from '../material/menu/item'
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
export function useMentionMenuItem(): (
  userId: SbUserId,
  items: React.ReactNode[],
  onMenuClose: (event?: MouseEvent) => void,
) => React.ReactNode[] {
  const chatContext = useContext(ChatContext)
  const onMentionClick = useCallback(
    (userId: SbUserId, onMenuClose: (event?: MouseEvent) => void) => {
      chatContext.mentionUser(userId)
      onMenuClose()
    },
    [chatContext],
  )
  return useCallback(
    (userId: SbUserId, items: React.ReactNode[], onMenuClose: (event?: MouseEvent) => void) => {
      // TODO(2Pac): Make the `items` a map of "menu item category" -> "items" so we can add this
      // action to the end of a "general" category, but before the "party" category. Or something
      // like that.
      items.push(
        <MenuItem
          key='mention'
          text='Mention'
          onClick={() => onMentionClick(userId, onMenuClose)}
        />,
      )
      return items
    },
    [onMentionClick],
  )
}
