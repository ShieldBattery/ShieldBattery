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
import {
  ChatViewAnchor,
  chatViewAnchorStore,
  findChatViewPlacement,
  scrollToAnchoredMessage,
} from '../messaging/chat-view-anchor'
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

/** A place in a conversation the list is on its way to. */
type PendingScrollTarget =
  /** The unread divider, wherever it sat when the move was started. */
  | { kind: 'unreadLine'; unreadLineTime: number }
  /** The reading position the user left the conversation at, saved under `viewStateKey`. */
  | {
      kind: 'anchor'
      viewStateKey: string
      anchor: ChatViewAnchor
      /**
       * Which loaded window the current wait was started against. A different one means the
       * replacement the move was waiting on has arrived.
       */
      windowGenAtStart: number | undefined
      /** Whether a load has been seen in flight since the current wait was started. */
      sawLoading: boolean
      /**
       * Scroll height the last attempt at the position was made against, if one has been made. The
       * list can't land any closer until its content changes, so further attempts wait for that
       * rather than fighting whatever scrolling the user does in the meantime.
       */
      attemptedScrollHeight: number | undefined
    }

/**
 * A move the list can't make yet because it's waiting on history the list doesn't hold. It carries
 * what it was started for, so it can't outlive the conversation (or the divider position) it was
 * aimed at.
 */
interface PendingScroll {
  /** Identifies the conversation the move was started in. */
  refreshToken: unknown
  target: PendingScrollTarget
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
  listProps: Omit<MessageListProps, 'onScrollUpdate' | 'isRestorePending'>
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
   * Called with the at-bottom state the viewport settles in when the list arrives at a
   * conversation, and again whenever that state changes. The arrival report fires during the
   * commit that mounts or re-targets the list, before owners' effects run; when a move to a saved
   * reading position is pending, the report waits for the move to settle instead, so what's
   * reported is where the user actually ends up.
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
  // The last at-bottom state reported through `onAtBottomChange`, so only changes are reported.
  // Undefined while nothing has been reported for the current conversation, which makes the first
  // settled update report unconditionally: the owner has no other way to learn where the viewport
  // actually ended up.
  const wasAtBottomRef = useRef<boolean | undefined>(undefined)
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  // Set while the list is waiting for what it needs to reach a position to come into the loaded
  // window, so it can move there once it does.
  const pendingScrollRef = useRef<PendingScroll | undefined>(undefined)
  // The conversation the last scroll update was for, so the first update after a switch can start
  // that conversation's restore before anything else reads the scroll position.
  const lastSeenConversationRef = useRef<unknown>(undefined)
  // The divider the user has already had in view. The banner is a one-shot prompt for a divider
  // they haven't laid eyes on yet — once it's been on screen, scrolling back down doesn't
  // resurface the banner. Carries what it was recorded for, so a conversation switch or a newly
  // frozen divider starts fresh.
  const seenLineRef = useRef<{ refreshToken: unknown; unreadLineTime: number } | undefined>(
    undefined,
  )

  const {
    unreadLineTime,
    messages,
    loading,
    hasMoreHistory,
    hasNewerMessages,
    windowGeneration,
    refreshToken,
    viewStateKey,
  } = listProps

  /**
   * Starts moving the list to the position the user left this conversation at, if they left one
   * behind. A move becomes pending when reaching the position takes messages the window doesn't
   * hold: the position lies before the window, so a replacement one the owner is expected to ask
   * for has to arrive first, or the window ends too few messages below the position for the
   * viewport to sit at it, so a page of newer messages has to be appended. Everything else is
   * settled here and now, since the bottom is where the list already is.
   */
  const startAnchorRestore = (scroller: HTMLDivElement, key: string) => {
    const anchor = chatViewAnchorStore.get(key)
    if (!anchor) {
      return
    }

    const placement = findChatViewPlacement(messages, anchor)
    if (placement.kind === 'bottom') {
      return
    }

    let attemptedScrollHeight: number | undefined
    if (placement.kind === 'message') {
      const result = scrollToAnchoredMessage(scroller, placement.messageId, placement.offsetPx)
      if (result !== 'clamped') {
        return
      }
      if (!hasNewerMessages) {
        // The bottom of the window is the newest message there is, so a viewport that stopped above
        // the position is as close to it as the conversation gets.
        return
      }
      attemptedScrollHeight = scroller.scrollHeight
    }

    pendingScrollRef.current = {
      refreshToken,
      target: {
        kind: 'anchor',
        viewStateKey: key,
        anchor,
        windowGenAtStart: windowGeneration,
        sawLoading: false,
        attemptedScrollHeight,
      },
    }
  }

  /**
   * Carries a move that couldn't be made when it was started as far as the list now allows.
   *
   * A move waiting on a replacement window only ever gives up on something a committed render has
   * shown it: the window generation changing, or a load it watched start and then finish. "Nothing
   * is loading" on its own can't be trusted, because this runs from scroll updates as well as from
   * renders, and a scroll update between a commit and the request it triggers reads the loading
   * flag a render behind — as idle, when the request is about to be made. A generation change to a
   * window with no messages in it doesn't count as that replacement arriving either: it's the gap
   * before one, so the move re-arms against the new generation and keeps waiting.
   *
   * A move that found its position but couldn't reach it waits on something else entirely: the
   * content growing, since re-running the same attempt against the same content can only land where
   * it already did.
   */
  const applyPendingScroll = (scroller: HTMLDivElement) => {
    const pending = pendingScrollRef.current
    if (!pending) {
      return
    }

    if (pending.refreshToken !== refreshToken) {
      pendingScrollRef.current = undefined
      return
    }

    const target = pending.target
    if (target.kind === 'unreadLine') {
      if (target.unreadLineTime !== unreadLineTime) {
        // Where the divider sits changed out from under the move.
        pendingScrollRef.current = undefined
        return
      }

      const unreadLine = findUnreadLine(scroller)
      if (unreadLine) {
        pendingScrollRef.current = undefined
        scrollToUnreadLine(scroller, unreadLine)
      } else if (!loading) {
        // The window the move was waiting on has arrived and holds no divider, which means there
        // was nothing unread to move to after all.
        pendingScrollRef.current = undefined
      }
      return
    }

    const placement = findChatViewPlacement(messages, target.anchor)
    if (placement.kind === 'message') {
      if (scroller.scrollHeight === target.attemptedScrollHeight) {
        // The list holds exactly what the last attempt was made against, so trying again would land
        // in the same place while dragging the viewport away from wherever the user has scrolled.
        return
      }

      const result = scrollToAnchoredMessage(scroller, placement.messageId, placement.offsetPx)
      if (result === 'clamped' && hasNewerMessages) {
        // The window ends too few messages below the position for the viewport to sit at it. The
        // bottom edge of the list is in view in that state and asks for the page that fixes it, so
        // the move stays armed to finish once that page lands, waiting now on this window growing
        // rather than on the one it was originally aimed at.
        target.windowGenAtStart = windowGeneration
        target.sawLoading = false
        target.attemptedScrollHeight = scroller.scrollHeight
        return
      }
      if (result !== 'missing') {
        // The viewport is either at the position, or stopped short of it with the newest messages
        // already loaded, which is as close as the conversation goes.
        pendingScrollRef.current = undefined
        return
      }
    }

    if (windowGeneration !== target.windowGenAtStart) {
      if (messages.some(isServerOriginMessage)) {
        // A replacement window arrived and still can't hold the saved position, so the newest
        // messages are as close to it as this conversation gets.
        pendingScrollRef.current = undefined
        scroller.scrollTop = scroller.scrollHeight
        return
      }

      // The generation moved but left no content behind: the window was cleared to make way for a
      // replacement that hasn't arrived yet, not a replacement that failed to cover the position.
      // The wait carries over to whatever window fills it, so re-arm against this generation and
      // fall through to the loading latch below in case a request is already in flight this render.
      target.windowGenAtStart = windowGeneration
      target.sawLoading = false
    }

    if (target.sawLoading && !loading) {
      // A request went out and came back without replacing the window, so nothing more is coming.
      pendingScrollRef.current = undefined
      return
    }

    if (loading) {
      target.sawLoading = true
    }
  }

  const isRestorePending = (key: string) => {
    const target = pendingScrollRef.current?.target
    return target?.kind === 'anchor' && target.viewStateKey === key
  }

  const onScrollUpdate = (target: EventTarget, isListMount?: boolean) => {
    const scroller = target as HTMLDivElement
    scrollerRef.current = scroller

    // Any move has to happen before the scroll position is read below, so what the rest of this
    // reports is where the list actually ends up rather than where it passed through. A list that
    // has just mounted counts as arriving at its conversation however many times it happens: the
    // mount pins to the bottom, and nothing else here would put the viewport back.
    if (isListMount || lastSeenConversationRef.current !== refreshToken) {
      lastSeenConversationRef.current = refreshToken
      pendingScrollRef.current = undefined
      wasAtBottomRef.current = undefined
      if (viewStateKey !== undefined) {
        startAnchorRestore(scroller, viewStateKey)
      }
    } else {
      applyPendingScroll(scroller)
    }

    // A move that's still pending leaves the list wherever it was placed by default, which says
    // nothing about whether the user has caught up with the conversation.
    const restorePending = pendingScrollRef.current?.target.kind === 'anchor'

    const { scrollTop, scrollHeight, clientHeight } = scroller

    const newIsScrolledUp = scrollTop + clientHeight < scrollHeight
    setIsScrolledUp(newIsScrolledUp)

    const newAtBottom = !newIsScrolledUp
    if (!restorePending && newAtBottom !== wasAtBottomRef.current) {
      wasAtBottomRef.current = newAtBottom
      onAtBottomChange?.(newAtBottom)
    }

    const distanceFromBottom = scrollHeight - clientHeight - scrollTop
    setShowJumpToBottom(distanceFromBottom > clientHeight * JUMP_TO_BOTTOM_THRESHOLD_SCREENS)

    // Rects are read after the scrolling above, so the banner reflects where the divider ended up.
    const unreadLine = findUnreadLine(scroller)
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
      // The divider is above the loaded window: ask for a window that contains it, and let the
      // pending move do the scrolling once it renders.
      pendingScrollRef.current = {
        refreshToken,
        target: { kind: 'unreadLine', unreadLineTime },
      }
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
            <StyledMessageList
              {...listProps}
              onScrollUpdate={onScrollUpdate}
              isRestorePending={isRestorePending}
            />
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
