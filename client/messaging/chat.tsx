import { AnimatePresence, Transition, Variants } from 'motion/react'
import * as m from 'motion/react-m'
import * as React from 'react'
import { useContext, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { Merge, Simplify } from 'type-fest'
import { SbUserId } from '../../common/users/sb-user-id'
import { MaterialIcon } from '../icons/material/material-icon'
import { ElevatedButton } from '../material/button'
import { buttonReset } from '../material/button-reset'
import { MenuItem, MenuItemProps } from '../material/menu/item'
import { MenuItemSymbol, MenuItemType } from '../material/menu/menu-item-symbol'
import { UNREAD_LINE_SELECTOR } from '../messaging/common-message-layout'
import { MessageInput, MessageInputHandle, MessageInputProps } from '../messaging/message-input'
import { MessageList, MessageListProps } from '../messaging/message-list'
import { isServerOriginMessage } from '../messaging/message-records'
import { useAppDispatch } from '../redux-hooks'
import { labelMedium } from '../styles/typography'
import {
  BaseUserMenuItemsProvider,
  MenuItemCategory,
  UserMenuComponent,
  UserMenuContext,
} from '../users/user-context-menu'
import { ChatContext } from './chat-context'
import { DefaultMessageMenu, MessageMenuComponent } from './message-context-menu'

/**
 * How far above the bottom of the message list, in viewport heights, the user must scroll before
 * the jump-to-bottom button appears.
 */
const JUMP_TO_BOTTOM_THRESHOLD_SCREENS = 1.5

/** How much room to leave above the unread divider when jumping to it, in pixels. */
const UNREAD_LINE_SCROLL_MARGIN_PX = 8

/** An in-progress hunt for the unread divider, waiting on history the list doesn't hold yet. */
interface UnreadLineSeek {
  /** Identifies the conversation the seek was started in. */
  refreshToken: unknown
  /** Where the divider sat when the seek was started. */
  unreadLineTime: number
}

function findUnreadLine(scroller: HTMLElement): HTMLElement | null {
  return scroller.querySelector<HTMLElement>(UNREAD_LINE_SELECTOR)
}

function scrollToUnreadLine(scroller: HTMLElement, unreadLine: HTMLElement) {
  // Positions are read as rects rather than offsets because the divider's offset parent isn't
  // guaranteed to be the scroller.
  const scrollerTop = scroller.getBoundingClientRect().top
  const lineTop = unreadLine.getBoundingClientRect().top
  scroller.scrollTop += lineTop - scrollerTop - UNREAD_LINE_SCROLL_MARGIN_PX
}

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
  left: 0;
  right: 0;
  bottom: 12px;
  display: flex;
  justify-content: center;
  pointer-events: none;
`

const JumpToBottomButton = styled(ElevatedButton)`
  pointer-events: auto;
`

const UnreadBannerButton = styled(m.button)`
  ${buttonReset};
  ${labelMedium};

  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 24px;
  padding: 0 12px;

  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;

  background-color: var(--theme-amber-container);
  border-radius: 0 0 4px 4px;
  color: var(--theme-on-amber-container);
  text-align: left;

  &:focus-visible {
    outline: 2px solid var(--theme-on-amber-container);
    outline-offset: -2px;
  }
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

const unreadBannerVariants: Variants = {
  initial: {
    opacity: 0,
    y: -8,
  },
  visible: {
    opacity: 1,
    y: 0,
  },
  exit: {
    opacity: 0,
    y: -8,
  },
}

const overlayTransition: Transition = {
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
  /**
   * Called when the user asks to go back to the newest messages while the list is showing a window
   * of history detached from the present. Owners are expected to load that newest page. Only
   * meaningful for surfaces that keep history on the server; without it the jump button can only
   * reach the bottom of what's loaded.
   */
  onJumpToPresent?: () => void
  /**
   * Called when the user asks to jump to the unread divider but it sits outside the loaded window.
   * Owners are expected to load a window of history around the read position. Only meaningful for
   * surfaces that keep history on the server; without it the jump can't reach past what's loaded.
   */
  onSeekToUnread?: () => void
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
  onJumpToPresent,
  onSeekToUnread,
}: ChatProps) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const [isScrolledUp, setIsScrolledUp] = useState<boolean>(false)
  const [showJumpToBottom, setShowJumpToBottom] = useState<boolean>(false)
  const [showUnreadBanner, setShowUnreadBanner] = useState<boolean>(false)
  // Message lists mount pinned to the bottom, matching how `MessageList` initially scrolls.
  const wasAtBottomRef = useRef(true)
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  // Set while we're waiting for the unread divider to come into the loaded window, so we can jump
  // to it once it does. It carries what it was started for, so a seek can't outlive the
  // conversation (or the divider position) it was aimed at.
  const seekRef = useRef<UnreadLineSeek | undefined>(undefined)
  // The divider the user has already had in view. The banner is a one-shot prompt for a divider
  // they haven't laid eyes on yet — once it's been on screen, scrolling back down doesn't
  // resurface the banner. Carries what it was recorded for, so a conversation switch or a newly
  // frozen divider starts fresh.
  const seenLineRef = useRef<{ refreshToken: unknown; unreadLineTime: number } | undefined>(
    undefined,
  )

  const { unreadLineTime, messages, loading, hasMoreHistory, hasNewerMessages, refreshToken } =
    listProps

  const onScrollUpdate = (target: EventTarget) => {
    const scroller = target as HTMLDivElement
    const { scrollTop, scrollHeight, clientHeight } = scroller

    const newIsScrolledUp = scrollTop + clientHeight < scrollHeight
    setIsScrolledUp(newIsScrolledUp)

    const newAtBottom = !newIsScrolledUp
    if (newAtBottom !== wasAtBottomRef.current) {
      wasAtBottomRef.current = newAtBottom
      onAtBottomChange?.(newAtBottom)
    }

    const distanceFromBottom = scrollHeight - clientHeight - scrollTop
    setShowJumpToBottom(distanceFromBottom > clientHeight * JUMP_TO_BOTTOM_THRESHOLD_SCREENS)

    scrollerRef.current = scroller

    const unreadLine = findUnreadLine(scroller)

    const seek = seekRef.current
    if (seek) {
      if (seek.refreshToken !== refreshToken || seek.unreadLineTime !== unreadLineTime) {
        // The conversation, or where its divider sits, changed out from under the seek.
        seekRef.current = undefined
      } else if (unreadLine) {
        seekRef.current = undefined
        scrollToUnreadLine(scroller, unreadLine)
      } else if (!loading) {
        // The window the seek was waiting on has arrived and holds no divider, which means there
        // was nothing unread to move to after all.
        seekRef.current = undefined
      }
    }

    // Rects are read after the scrolling above, so the banner reflects where the divider ended up.
    let newShowUnreadBanner = false
    if (unreadLineTime !== undefined) {
      if (unreadLine) {
        const scrollerRect = scroller.getBoundingClientRect()
        const lineRect = unreadLine.getBoundingClientRect()
        if (lineRect.bottom > scrollerRect.top && lineRect.top < scrollerRect.bottom) {
          seenLineRef.current = { refreshToken, unreadLineTime }
        }
        newShowUnreadBanner = lineRect.bottom - scrollerRect.top < 0
      } else {
        // With no divider rendered, the boundary is above the loaded window if even the oldest
        // loaded message is newer than the read position. Anything else means there's nothing
        // unread to jump to.
        const oldestServerMessage = messages.find(isServerOriginMessage)
        newShowUnreadBanner =
          oldestServerMessage !== undefined && oldestServerMessage.time > unreadLineTime
      }

      const seen = seenLineRef.current
      if (seen && seen.refreshToken === refreshToken && seen.unreadLineTime === unreadLineTime) {
        newShowUnreadBanner = false
      }
    }
    setShowUnreadBanner(newShowUnreadBanner)
  }

  const onJumpToBottomClick = () => {
    if (hasNewerMessages) {
      // The bottom of the loaded window isn't the newest message, so getting there takes a fetch.
      onJumpToPresent?.()
      return
    }

    const scroller = scrollerRef.current
    if (scroller) {
      scroller.scrollTop = scroller.scrollHeight
    }
  }

  const onUnreadBannerClick = () => {
    const scroller = scrollerRef.current
    if (!scroller) {
      return
    }

    const unreadLine = findUnreadLine(scroller)
    if (unreadLine) {
      scrollToUnreadLine(scroller, unreadLine)
      return
    }

    if (unreadLineTime === undefined) {
      return
    }

    if (!hasMoreHistory) {
      // Everything there is has been loaded without turning up a divider, so the top of the list is
      // as close as we can get to where the user left off.
      scroller.scrollTop = 0
      return
    }

    if (onSeekToUnread) {
      // The divider is above the loaded window: ask for a window that contains it, and let the seek
      // do the scrolling once it renders.
      seekRef.current = { refreshToken, unreadLineTime }
      onSeekToUnread()
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
              {showUnreadBanner && unreadLineTime !== undefined ? (
                <UnreadBannerButton
                  key='new-messages'
                  variants={unreadBannerVariants}
                  initial='initial'
                  animate='visible'
                  exit='exit'
                  transition={overlayTransition}
                  onClick={onUnreadBannerClick}>
                  <span>{t('messaging.newMessages', 'New messages')}</span>
                  <MaterialIcon icon='arrow_upward' size={16} />
                </UnreadBannerButton>
              ) : null}
            </AnimatePresence>
            <AnimatePresence>
              {showJumpToBottom || hasNewerMessages ? (
                <JumpToBottomButtonContainer
                  key='jump-to-bottom'
                  variants={jumpToBottomVariants}
                  initial='initial'
                  animate='visible'
                  exit='exit'
                  transition={overlayTransition}>
                  <JumpToBottomButton
                    iconStart={<MaterialIcon icon='arrow_downward' size={20} />}
                    label={
                      hasNewerMessages
                        ? t('messaging.jumpToPresent', 'Jump to present')
                        : t('messaging.jumpToBottom', 'Jump to bottom')
                    }
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
