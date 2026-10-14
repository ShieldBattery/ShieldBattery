import { useTranslation } from 'react-i18next'
import {
  appendToMultimap,
  cloneMultimap,
  prependToMultimap,
} from '../../common/data-structures/maps'
import { getErrorStack } from '../../common/errors'
import logger from '../logging/logger'
import { MenuItem } from '../material/menu/item'
import {
  MenuItemCategory as MessageMenuItemCategory,
  MessageMenuProps,
} from '../messaging/message-context-menu'
import { getServerOrigin } from '../network/server-url'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { DURATION_LONG } from '../snackbars/snackbar-durations'
import { useSnackbarController } from '../snackbars/snackbar-overlay'
import { MenuItemCategory, UserMenuProps } from '../users/user-context-menu'
import { closeWhisperSession, markWhisperReadNow } from './action-creators'
import { urlForWhisperMessageLink } from './whisper-url'

export function WhisperMessageMenu({
  messageId,
  items,
  onMenuClose,
  MenuComponent,
}: MessageMenuProps) {
  const { t } = useTranslation()

  const menuItems = new Map(items)
  appendToMultimap(
    menuItems,
    MessageMenuItemCategory.General,
    <MenuItem
      key='copy-message-link'
      text={t('whispers.messageMenu.copyMessageLink', 'Copy message link')}
      onClick={() => {
        navigator.clipboard
          .writeText(getServerOrigin() + urlForWhisperMessageLink(messageId))
          .catch(err => logger.error(`Error writing to clipboard: ${getErrorStack(err)}`))
        onMenuClose()
      }}
    />,
  )

  return <MenuComponent items={menuItems} messageId={messageId} onMenuClose={onMenuClose} />
}

/**
 * Adds "Mark as read" to the user context menu when it's opened from a whisper conversation's entry,
 * the one place the menu is about the conversation as much as the user.
 */
export function WhisperConversationUserMenu({
  userId,
  items,
  onMenuClose,
  MenuComponent,
}: UserMenuProps) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const snackbarController = useSnackbarController()
  const canMarkRead = useAppSelector(s => {
    const session = s.whispers.byId.get(userId)
    return session !== undefined && (session.hasUnread || session.unreadLine !== undefined)
  })
  const isSessionOpen = useAppSelector(s => s.whispers.sessions.has(userId))

  const menuItems = cloneMultimap(items)
  prependToMultimap(
    menuItems,
    MenuItemCategory.General,
    <MenuItem
      key='mark-as-read'
      text={t('common.actions.markAsRead', 'Mark as read')}
      disabled={!canMarkRead}
      onClick={() => {
        onMenuClose()
        dispatch(markWhisperReadNow(userId))
      }}
    />,
  )

  if (isSessionOpen) {
    appendToMultimap(
      menuItems,
      MenuItemCategory.General,
      <MenuItem
        key='close-whisper'
        text={t('whispers.navEntry.closeWhisper', 'Close whisper')}
        onClick={() => {
          onMenuClose()
          dispatch(
            closeWhisperSession(userId, {
              onSuccess: () => {},
              onError: err => {
                snackbarController.showSnackbar(
                  t('navigation.leftNav.whisperCloseError', {
                    defaultValue: 'Error closing whisper session: {{errorMessage}}',
                    errorMessage: err.message,
                  }),
                  DURATION_LONG,
                )
              },
            }),
          )
        }}
      />,
    )
  }

  return <MenuComponent items={menuItems} userId={userId} onMenuClose={onMenuClose} />
}
