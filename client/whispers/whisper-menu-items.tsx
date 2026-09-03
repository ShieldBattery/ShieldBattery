import { useTranslation } from 'react-i18next'
import { appendToMultimap } from '../../common/data-structures/maps'
import { getErrorStack } from '../../common/errors'
import logger from '../logging/logger'
import { MenuItem } from '../material/menu/item'
import {
  MenuItemCategory as MessageMenuItemCategory,
  MessageMenuProps,
} from '../messaging/message-context-menu'
import { getServerOrigin } from '../network/server-url'
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
