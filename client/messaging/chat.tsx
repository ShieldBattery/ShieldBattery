import * as React from 'react'
import { useCallback, useContext, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { Merge, Simplify } from 'type-fest'
import { SbUserId } from '../../common/users/sb-user-id'
import { MenuItem, MenuItemProps } from '../material/menu/item'
import { MenuItemSymbol, MenuItemType } from '../material/menu/menu-item-symbol'
import { MessageInput, MessageInputHandle, MessageInputProps } from '../messaging/message-input'
import { MessageList, MessageListProps } from '../messaging/message-list'
import { useAppDispatch } from '../redux-hooks'
import {
  BaseUserMenuItemsProvider,
  MenuItemCategory,
  UserMenuComponent,
  UserMenuContext,
} from '../users/user-context-menu'
import { ChatContext, DefaultMessageMenu, MessageMenuComponent } from './chat-context'

const MessagesAndInput = styled.div`
  position: relative;
  display: flex;
  flex-direction: column;
  min-width: 320px;
  height: 100%;
  contain: content;
`

const StyledMessageList = styled(MessageList)`
  position: relative;
  flex-grow: 1;
`

export interface ChatProps {
  className?: string
  listProps: Omit<MessageListProps, 'onScrollUpdate'>
  inputProps: Omit<MessageInputProps, 'showDivider'>
  /**
   * Optional header component which will be rendered on top of the message list. This is useful if
   * you need to show more information about the current chat content.
   */
  header?: React.ReactNode
  /**
   * Optional background content (usually an image) which will be rendered behind the message list.
   * Should be absolutely positioned and have lower opacity so the messages are readable.
   */
  backgroundContent?: React.ReactNode
  /**
   * Optional extra content to place within the chat context provider. This is useful if you need to
   * e.g. mention users via shift-click from UIs outside the message list.
   */
  extraContent?: React.ReactNode
  /** An optional component type that will be used to render user context menu items. */
  UserMenu?: UserMenuComponent
  /** An optional component type that will be used to render message context menu items. */
  MessageMenu?: MessageMenuComponent
}

/**
 * This is a general chat component that combines `MessageList` and `MessageInput` components into
 * one, with some common styling. We're using this component in pretty much all of our
 * messaging-related services (e.g. chat channels, whispers, lobbies, parties), but in case you need
 * to do something special, you can always use `MessageList` and `MessageInput` directly.
 */
export function Chat({
  className,
  listProps,
  inputProps,
  header,
  backgroundContent,
  extraContent,
  UserMenu,
  MessageMenu = DefaultMessageMenu,
}: ChatProps) {
  const dispatch = useAppDispatch()
  const [isScrolledUp, setIsScrolledUp] = useState<boolean>(false)

  const onScrollUpdate = useCallback((target: EventTarget) => {
    const { scrollTop, scrollHeight, clientHeight } = target as HTMLDivElement

    const newIsScrolledUp = scrollTop + clientHeight < scrollHeight
    setIsScrolledUp(newIsScrolledUp)
  }, [])

  const messageInputRef = useRef<MessageInputHandle>(null)

  const mentionUser = (userId: SbUserId) => {
    dispatch((_, getState) => {
      const { users } = getState()
      const user = users.byId.get(userId)
      if (user) {
        messageInputRef.current?.addMention(user.name)
      }
    })
  }

  const onMentionMenuItemClick = (userId: SbUserId, onMenuClose: (event?: MouseEvent) => void) => {
    mentionUser(userId)
    onMenuClose()
  }

  return (
    <BaseUserMenuItemsProvider
      items={
        new Map<MenuItemCategory, React.ReactNode[]>([
          [
            MenuItemCategory.General,
            [<MentionMenuItem key='mention' onClick={onMentionMenuItemClick} />],
          ],
        ])
      }>
      <ChatContext.Provider
        value={{
          mentionUser,
          UserMenu,
          MessageMenu,
        }}>
        <MessagesAndInput className={className}>
          {header}
          {backgroundContent}
          <StyledMessageList {...listProps} onScrollUpdate={onScrollUpdate} />
          <MessageInput
            {...inputProps}
            ref={messageInputRef}
            showDivider={isScrolledUp}
            key={inputProps.storageKey}
          />
        </MessagesAndInput>
        {extraContent}
      </ChatContext.Provider>
    </BaseUserMenuItemsProvider>
  )
}

function MentionMenuItem({
  onClick,
  ...menuItemProps
}: Simplify<
  Merge<
    Omit<MenuItemProps, 'text'>,
    {
      onClick: (userId: SbUserId, onMenuClose: (event?: MouseEvent) => void) => void
    }
  >
>) {
  const { t } = useTranslation()
  const { userId, onMenuClose } = useContext(UserMenuContext)
  return (
    <MenuItem
      {...menuItemProps}
      key='mention'
      text={t('messaging.mention', 'Mention')}
      onClick={() => onClick(userId, onMenuClose)}
    />
  )
}

MentionMenuItem[MenuItemSymbol] = MenuItemType.Default
