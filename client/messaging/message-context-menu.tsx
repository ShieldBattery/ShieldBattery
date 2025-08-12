import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { appendToMultimap } from '../../common/data-structures/maps'
import { getErrorStack } from '../../common/errors'
import logger from '../logging/logger'
import { Divider } from '../material/menu/divider'
import { MenuItem } from '../material/menu/item'
import { MenuList } from '../material/menu/menu'
import { Popover, PopoverProps } from '../material/popover'

/**
 * All the possible categories of the menu items in the message context menu. In case you're not
 * sure what constitues a new category, a divider will be inserted between each category, so it
 * might help to think of it in those terms.
 */
export enum MenuItemCategory {
  /** Contains general menu items that are not grouped by any specific purpose. */
  General = 'General',
  /**
   * Contains destructive menu items that are usually shown in red color to highlight their
   * importance.
   */
  Destructive = 'Destructive',
}

// Not using Object.values() here to define the order we want.
export const ALL_MENU_ITEM_CATEGORIES: ReadonlyArray<MenuItemCategory> = [
  MenuItemCategory.General,
  MenuItemCategory.Destructive,
]

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
  items: ReadonlyMap<MenuItemCategory, React.ReactNode[]>
  /**
   * An event handler that will be called when the menu closes.
   */
  onMenuClose: (event?: MouseEvent) => void

  /**
   * Component type to use to render the menu items in the `MessageMenuItemsComponent`.
   */
  MenuComponent: React.ComponentType<{
    items: ReadonlyMap<MenuItemCategory, React.ReactNode[]>
    messageId: string
    onMenuClose: (event?: MouseEvent) => void
  }>
}

export type MessageMenuComponent = React.ComponentType<MessageMenuProps>

export interface MessageMenuContextValue {
  messageId: string
  onMenuClose: (event?: MouseEvent) => void
}

export const MessageMenuContext = React.createContext<MessageMenuContextValue>({
  messageId: '',
  onMenuClose: () => {},
})

export function DefaultMessageMenu({
  items,
  MenuComponent,
  messageId,
  onMenuClose,
}: MessageMenuProps) {
  return <MenuComponent items={items} messageId={messageId} onMenuClose={onMenuClose} />
}

export interface ConnectedMessageContextMenuProps {
  messageId: string
  /** Text that was selected by the user at the point they opened the message context menu. */
  selectedText: string
  /**
   * An optional component that will be used for rendering menu items. This component can modify
   * the menu items given before passing them for rendering.
   */
  MessageMenu?: MessageMenuComponent
  popoverProps: Omit<PopoverProps, 'children'>
}

export function MessageContextMenu({
  messageId,
  selectedText,
  MessageMenu,
  popoverProps,
}: ConnectedMessageContextMenuProps) {
  return (
    <Popover {...popoverProps}>
      <MessageContextMenuContents
        messageId={messageId}
        selectedText={selectedText}
        MessageMenu={MessageMenu}
        onDismiss={popoverProps.onDismiss}
      />
    </Popover>
  )
}

/**
 * Helper component for message context menu to make sure the hooks are only run when the menu is
 * open.
 */
function MessageContextMenuContents({
  messageId,
  selectedText,
  MessageMenu = DefaultMessageMenu,
  onDismiss,
}: Omit<ConnectedMessageContextMenuProps, 'popoverProps'> & {
  onDismiss: () => void
}) {
  const { t } = useTranslation()

  const items: Map<MenuItemCategory, React.ReactNode[]> = new Map()
  if (selectedText) {
    appendToMultimap(
      items,
      MenuItemCategory.General,
      <MenuItem
        key='copy'
        text={t('common.actions.copy', 'Copy')}
        onClick={() => {
          navigator.clipboard
            .writeText(selectedText)
            .catch(err => logger.error(`Error writing to clipboard: ${getErrorStack(err)}`))
          onDismiss()
        }}
      />,
    )
    appendToMultimap(
      items,
      MenuItemCategory.General,
      <MenuItem
        key='search-with-google'
        text={t('messaging.searchWithGoogle', 'Search with Google')}
        onClick={() => {
          const a = document.createElement('a')
          a.href = `https://www.google.com/search?q=${encodeURIComponent(selectedText)}`
          a.target = '_blank'
          a.click()
          onDismiss()
        }}
      />,
    )
  }

  return items.size > 0 ? (
    <MessageMenu
      messageId={messageId}
      items={items}
      onMenuClose={onDismiss}
      MenuComponent={MessageContextMenuList}
    />
  ) : null
}

function MessageContextMenuList({
  items,
  messageId,
  onMenuClose,
}: {
  items: ReadonlyMap<MenuItemCategory, React.ReactNode[]>
  messageId: string
  onMenuClose: (event?: MouseEvent) => void
}) {
  const orderedMenuItems = ALL_MENU_ITEM_CATEGORIES.reduce<React.ReactNode[]>((elems, category) => {
    const categoryItems = items.get(category) ?? []

    if (elems.length > 0 && categoryItems.length > 0) {
      elems.push(<Divider key={`divider-${category}`} $dense={true} />)
    }

    elems.push(...categoryItems)
    return elems
  }, [])

  return (
    <MessageMenuContext.Provider value={{ messageId, onMenuClose }}>
      <MenuList dense={true}>{orderedMenuItems}</MenuList>
    </MessageMenuContext.Provider>
  )
}
