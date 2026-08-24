import { AnimatePresence, Transition, Variants } from 'motion/react'
import * as m from 'motion/react-m'
import * as React from 'react'
import { useCallback, useContext, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { Merge, Simplify } from 'type-fest'
import { SbUserId } from '../../common/users/sb-user-id'
import { MaterialIcon } from '../icons/material/material-icon'
import { IconButton } from '../material/button'
import { MenuItem, MenuItemProps } from '../material/menu/item'
import { MenuItemSymbol, MenuItemType } from '../material/menu/menu-item-symbol'
import { elevationPlus2 } from '../material/shadows'
import { MessageInput, MessageInputHandle, MessageInputProps } from '../messaging/message-input'
import { MessageList, MessageListProps } from '../messaging/message-list'
import { useAppDispatch } from '../redux-hooks'
import {
  BaseUserMenuItemsProvider,
  MenuItemCategory,
  UserMenuComponent,
  UserMenuContext,
} from '../users/user-context-menu'
import { ChatContext } from './chat-context'
import { DefaultMessageMenu, MessageMenuComponent } from './message-context-menu'

/**
 * How far above the bottom of the message list, in pixels, the user must scroll before the
 * jump-to-bottom button appears.
 */
const JUMP_TO_BOTTOM_THRESHOLD_PX = 160

const MessagesAndInput = styled.div`
  position: relative;
  display: flex;
  flex-direction: column;
  min-width: 320px;
  height: 100%;
  contain: content;
`

const MessageListContainer = styled.div`
  position: relative;
  flex-grow: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
`

const StyledMessageList = styled(MessageList)`
  position: relative;
  flex-grow: 1;
`

const JumpToBottomButtonContainer = styled(m.div)`
  position: absolute;
  right: 16px;
  bottom: 12px;
  display: flex;
`

const JumpToBottomButton = styled(IconButton)`
  width: 40px;
  min-height: 40px;
  border-radius: 50%;

  background-color: var(--theme-container-highest);
  color: var(--theme-on-surface);

  ${elevationPlus2};
`

const jumpToBottomVariants: Variants = {
  initial: {
    opacity: 0,
    y: 8,
  },
  visible: {
    opacity: 1,
    y: 0,
  },
  exit: {
    opacity: 0,
    y: 8,
  },
}

const jumpToBottomTransition: Transition = {
  type: 'tween',
  duration: 0.12,
}

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
  /** If true, prevents mentions and usernames from being interactable. Defaults to false. */
  disallowMentionInteraction?: boolean
  /**
   * Called when the user's scrolled-to-bottom state changes. Message lists mount pinned to the
   * bottom, so owners should assume at-bottom initially.
   */
  onAtBottomChange?: (atBottom: boolean) => void
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
  disallowMentionInteraction: disallowUserInteraction,
  onAtBottomChange,
}: ChatProps) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const [isScrolledUp, setIsScrolledUp] = useState<boolean>(false)
  const [showJumpToBottom, setShowJumpToBottom] = useState<boolean>(false)
  // Message lists mount pinned to the bottom, matching how `MessageList` initially scrolls.
  const wasAtBottomRef = useRef(true)
  const scrollerRef = useRef<HTMLDivElement | null>(null)

  const onScrollUpdate = useCallback(
    (target: EventTarget) => {
      const { scrollTop, scrollHeight, clientHeight } = target as HTMLDivElement

      const newIsScrolledUp = scrollTop + clientHeight < scrollHeight
      setIsScrolledUp(newIsScrolledUp)

      const newAtBottom = !newIsScrolledUp
      if (newAtBottom !== wasAtBottomRef.current) {
        wasAtBottomRef.current = newAtBottom
        onAtBottomChange?.(newAtBottom)
      }

      const distanceFromBottom = scrollHeight - clientHeight - scrollTop
      setShowJumpToBottom(distanceFromBottom > JUMP_TO_BOTTOM_THRESHOLD_PX)

      scrollerRef.current = target as HTMLDivElement
    },
    [onAtBottomChange],
  )

  const onJumpToBottomClick = () => {
    const scroller = scrollerRef.current
    if (scroller) {
      scroller.scrollTop = scroller.scrollHeight
    }
  }

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
          disallowMentionInteraction: disallowUserInteraction,
        }}>
        <MessagesAndInput className={className}>
          {header}
          {backgroundContent}
          <MessageListContainer>
            <StyledMessageList {...listProps} onScrollUpdate={onScrollUpdate} />
            <AnimatePresence>
              {showJumpToBottom ? (
                <JumpToBottomButtonContainer
                  key='jump-to-bottom'
                  variants={jumpToBottomVariants}
                  initial='initial'
                  animate='visible'
                  exit='exit'
                  transition={jumpToBottomTransition}>
                  <JumpToBottomButton
                    icon={<MaterialIcon icon='arrow_downward' />}
                    title={t('messaging.jumpToBottom', 'Jump to bottom')}
                    ariaLabel={t('messaging.jumpToBottom', 'Jump to bottom')}
                    onClick={onJumpToBottomClick}
                  />
                </JumpToBottomButtonContainer>
              ) : null}
            </AnimatePresence>
          </MessageListContainer>
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
