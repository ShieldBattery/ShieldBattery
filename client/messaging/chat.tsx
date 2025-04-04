import React, { useCallback, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { appendToMultimap } from '../../common/data-structures/maps'
import { SbUserId } from '../../common/users/sb-user-id'
import { MenuItem } from '../material/menu/item'
import { MessageInput, MessageInputHandle, MessageInputProps } from '../messaging/message-input'
import { MessageList, MessageListProps } from '../messaging/message-list'
import { useStableCallback } from '../react/state-hooks'
import { useAppDispatch } from '../redux-hooks'
import { MenuItemCategory } from '../users/user-context-menu'
import { ChatContext, ChatContextValue } from './chat-context'

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
  /**
   * An optional function that will be called when rendering user menu items. If provided, the value
   * returned from this function will be used as the `children` of the user context menu. Mutating
   * the input value and returning it is okay.
   */
  modifyUserMenuItems?: (
    userId: SbUserId,
    items: Map<MenuItemCategory, React.ReactNode[]>,
    onMenuClose: (event?: MouseEvent) => void,
  ) => Map<MenuItemCategory, React.ReactNode[]>
  /**
   * An optional function that will be called when rendering message menu items. If provided, the
   * value returned from this function will be used as the `children` of the message context menu.
   * Mutating the input value and returning it is okay.
   */
  modifyMessageMenuItems?: (
    messageId: string,
    items: React.ReactNode[],
    onMenuClose: (event?: MouseEvent) => void,
  ) => React.ReactNode[]
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
  modifyUserMenuItems,
  modifyMessageMenuItems,
}: ChatProps) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const [isScrolledUp, setIsScrolledUp] = useState<boolean>(false)

  const onScrollUpdate = useCallback((target: EventTarget) => {
    const { scrollTop, scrollHeight, clientHeight } = target as HTMLDivElement

    const newIsScrolledUp = scrollTop + clientHeight < scrollHeight
    setIsScrolledUp(newIsScrolledUp)
  }, [])

  const messageInputRef = useRef<MessageInputHandle>(null)

  const mentionUser = useStableCallback((userId: SbUserId) => {
    dispatch((_, getState) => {
      const { users } = getState()
      const user = users.byId.get(userId)
      if (user) {
        messageInputRef.current?.addMention(user.name)
      }
    })
  })

  const onMentionMenuItemClick = useStableCallback(
    (userId: SbUserId, onMenuClose: (event?: MouseEvent) => void) => {
      mentionUser(userId)
      onMenuClose()
    },
  )

  const chatContextValue = useMemo<ChatContextValue>(
    () => ({
      mentionUser,
      modifyUserMenuItems: (
        userId: SbUserId,
        items: Map<MenuItemCategory, React.ReactNode[]>,
        onMenuClose: (event?: MouseEvent) => void,
      ) => {
        appendToMultimap(
          items,
          MenuItemCategory.General,
          <MenuItem
            key='mention'
            text={t('messaging.mention', 'Mention')}
            onClick={() => onMentionMenuItemClick(userId, onMenuClose)}
          />,
        )

        return modifyUserMenuItems?.(userId, items, onMenuClose) ?? items
      },
      modifyMessageMenuItems: (
        messageId: string,
        items: React.ReactNode[],
        onMenuClose: (event?: MouseEvent) => void,
      ) => {
        return modifyMessageMenuItems?.(messageId, items, onMenuClose) ?? items
      },
    }),
    [mentionUser, modifyMessageMenuItems, modifyUserMenuItems, onMentionMenuItemClick, t],
  )

  return (
    <ChatContext.Provider value={chatContextValue}>
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
  )
}
