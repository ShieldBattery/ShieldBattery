import * as React from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { ReadonlyDeep } from 'type-fest'
import { ServerChatMessageType } from '../../common/chat'
import { UserRelationshipJson } from '../../common/users/relationships'
import { SbUserId } from '../../common/users/sb-user-id'
import { useSelfUser } from '../auth/auth-utils'
import InfiniteScrollList from '../lists/infinite-scroll-list'
import { animationFrameHandler } from '../material/animation-frame-handler'
import { useAppSelector } from '../redux-hooks'
import { selectableTextContainer } from '../styles/text-selection'
import { bodyLarge } from '../styles/typography'
import { captureChatViewAnchor, chatViewAnchorStore } from './chat-view-anchor'
import {
  BlockedMessage,
  NewDayMessage,
  TextMessage,
  UnreadLineMessage,
} from './common-message-layout'
import {
  CommonMessageType,
  CommonNewDayMessage,
  isServerOriginMessage,
  SbMessage,
} from './message-records'

/**
 * Returns the index of the message the unread divider should be rendered in front of, or -1 if the
 * divider shouldn't be rendered. That's the first message with a server-recorded time newer than
 * the given read position; messages that only exist on the client can't be compared against it at
 * all, and a message at exactly the read position has been read.
 *
 * When every loaded server message is newer than the read position and more history exists, the
 * true boundary lies above the loaded window, so no index is returned — rendering the divider at
 * the top of the window would misrepresent where the unread messages start. Loading more history
 * eventually brings a read message (or the very beginning) into the window, at which point the
 * divider gets a real position.
 */
export function findUnreadLineIndex(
  messages: ReadonlyArray<SbMessage>,
  unreadLineTime: number | undefined,
  hasMoreHistory: boolean | undefined,
): number {
  if (unreadLineTime === undefined) {
    return -1
  }

  const index = messages.findIndex(m => isServerOriginMessage(m) && m.time > unreadLineTime)
  if (index === -1) {
    return -1
  }

  const hasReadMessageAbove = messages.slice(0, index).some(m => isServerOriginMessage(m))
  return hasReadMessageAbove || !hasMoreHistory ? index : -1
}

function isSameDay(d1: Date, d2: Date) {
  return (
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate()
  )
}

/**
 * How many pixels a user can be away from the bottom of the scrollable area and still be
 * considered "at the bottom" for the purposes of autoscrolling.
 */
const AUTOSCROLL_LEEWAY_PX = 8

const Scrollable = styled.div`
  padding: 8px 16px 0px 8px;
  overflow-y: auto;
  /**
    This component fully manages its own scroll position (pinning to the bottom, compensating for
    prepended history). Browser scroll anchoring fights that: e.g. when messages are trimmed from
    the top while pinned to the bottom, it adjusts the scroll position to keep the old content in
    view, silently unpinning the list.
  */
  overflow-anchor: none;
`

const EmptyList = styled.div`
  ${bodyLarge};
  padding: 32px 16px 48px;

  color: var(--theme-on-surface-variant);
  text-align: center;
`

const Messages = styled.div`
  ${selectableTextContainer}
`

function CommonMessageOrFallback({
  message,
  selfUserId,
  blockedUsers,
  FallbackComponent,
}: {
  message: SbMessage
  selfUserId: SbUserId
  blockedUsers: ReadonlyDeep<Map<SbUserId, UserRelationshipJson>>
  FallbackComponent?: MessageComponentType
}) {
  switch (message.type) {
    case CommonMessageType.NewDayMessage:
      return <NewDayMessage key={message.id} time={message.time} />
    // TODO(2Pac): Reconcile these types into one when everything is moved to immer
    case CommonMessageType.TextMessage:
    case ServerChatMessageType.TextMessage:
      // TODO(tec27): Would probably be nice to collect adjacent blocked messages into a single
      // item?
      return blockedUsers.has(message.from) ? (
        <BlockedMessage
          key={message.id}
          msgId={message.id}
          userId={message.from}
          selfUserId={selfUserId}
          time={message.time}
          text={message.text}
        />
      ) : (
        <TextMessage
          key={message.id}
          msgId={message.id}
          userId={message.from}
          selfUserId={selfUserId}
          time={message.time}
          text={message.text}
        />
      )
    default:
      return FallbackComponent ? (
        <FallbackComponent
          key={message.id}
          message={message}
          blockedUsers={blockedUsers}
          selfUserId={selfUserId}
        />
      ) : null
  }
}

interface PureMessageListProps {
  messages: ReadonlyArray<SbMessage>
  showEmptyState: boolean
  MessageComponent?: MessageComponentType
  unreadLineTime?: number
  hasMoreHistory?: boolean
}

function PureMessageList({
  messages,
  showEmptyState,
  MessageComponent,
  unreadLineTime,
  hasMoreHistory,
}: PureMessageListProps) {
  const { t } = useTranslation()
  const selfUserId = useSelfUser()!.id
  const blocks = useAppSelector(s => s.relationships.blocks)

  if (messages.length < 1) {
    return showEmptyState ? (
      <EmptyList>{t('common.lists.empty', 'Nothing to see here')}</EmptyList>
    ) : undefined
  }

  const unreadLineIndex = findUnreadLineIndex(messages, unreadLineTime, hasMoreHistory)

  return (
    <Messages>
      {messages.map((m, index) => {
        const messageLayout = (
          <CommonMessageOrFallback
            key={m.id}
            message={m}
            selfUserId={selfUserId}
            blockedUsers={blocks}
            FallbackComponent={MessageComponent}
          />
        )

        const prevMessage = index > 0 ? messages[index - 1] : null
        const needsNewDay =
          !!prevMessage && !isSameDay(new Date(prevMessage.time), new Date(m.time))
        const needsUnreadLine = index === unreadLineIndex

        if (!needsNewDay && !needsUnreadLine) {
          return messageLayout
        }

        const dividers: React.ReactNode[] = []
        if (needsNewDay) {
          const newDayMessage: CommonNewDayMessage = {
            id: m.time + '-' + CommonMessageType.NewDayMessage,
            type: CommonMessageType.NewDayMessage,
            time: m.time,
          }

          dividers.push(
            <CommonMessageOrFallback
              key={'newday-' + m.id}
              message={newDayMessage}
              selfUserId={selfUserId}
              blockedUsers={blocks}
            />,
          )
        }
        if (needsUnreadLine) {
          dividers.push(<UnreadLineMessage key={'unread-' + m.id} />)
        }

        return [...dividers, messageLayout]
      })}
    </Messages>
  )
}

export interface MessageComponentProps {
  message: SbMessage
  selfUserId: SbUserId
  blockedUsers: ReadonlyDeep<Map<SbUserId, UserRelationshipJson>>
}

/** Component type to render a particular message. */
export type MessageComponentType = React.ComponentType<MessageComponentProps>

export interface MessageListProps {
  messages: ReadonlyArray<SbMessage>
  /** Whether to show empty state text when they are no messages. Defaults to true. */
  showEmptyState?: boolean
  /**
   * Component type which will be used to render each message that is not a common message type. If
   * not provided, only common messages will be rendered.
   */
  MessageComponent?: MessageComponentType
  className?: string
  /** Whether we are currently requesting more history for this message list. */
  loading?: boolean
  /** Whether this message list has more history available that could be requested. */
  hasMoreHistory?: boolean
  /**
   * Whether messages newer than the loaded window exist, that is, whether the window is detached
   * from the present.
   */
  hasNewerMessages?: boolean
  /**
   * A value that changes exactly when the loaded window is replaced or dropped wholesale (rather
   * than having messages added at one of its ends). On such an update the list leaves the viewport
   * alone — there's no previous content to hold in view — and whoever asked for the swap places it.
   */
  windowGeneration?: number
  /** Whether we are currently requesting newer messages for this message list. */
  loadingNewer?: boolean
  /**
   * A value that changes when the values the list is displaying change, e.g. if the list is now
   * displaying a different chat channel.
   */
  refreshToken?: unknown
  /**
   * Callback whenever the scroll position or scroll height has been updated (debounced to
   * animation frames).
   */
  onScrollUpdate?: (scrollTarget: EventTarget) => void
  onLoadMoreMessages?: () => void
  onLoadNewerMessages?: () => void
  /**
   * The read position (epoch millis) the unread divider should be placed at, if the list should
   * show one. The divider goes in front of the first message with a server-recorded time newer
   * than this.
   */
  unreadLineTime?: number
  /**
   * Key identifying the conversation being displayed, under which the reading position the user
   * leaves it at is saved. Surfaces whose chat is only meaningful for as long as it's on screen
   * (lobby chat, say) leave this unset, which turns saving off entirely.
   */
  viewStateKey?: string
  /**
   * Whether the list is still on its way to the saved reading position for the given key rather
   * than showing it. Reading a position out of the DOM while that's true would overwrite the saved
   * one with a position the user never chose.
   */
  isRestorePending?: (viewStateKey: string) => boolean
}

interface MessageListSnapshot {
  /** Whether the user was scrolled to the bottom of the content before the last update. */
  wasAtBottom: boolean
  /** What the scroll offset from top of the content was before the last update. */
  lastScrollTop: number
  /** What the scroll height of the content was before the last update. */
  lastScrollHeight: number
}

export class MessageList extends React.Component<MessageListProps> {
  private scrollableRef = React.createRef<HTMLDivElement>()
  private onScroll = animationFrameHandler(target => {
    if (target && this.props.onScrollUpdate) {
      this.props.onScrollUpdate(target)
    }
  })

  override componentWillUnmount() {
    this.onScroll.cancel()

    if (this.props.viewStateKey !== undefined) {
      this.saveViewState(this.props.viewStateKey, this.props.messages)
    }
  }

  /**
   * Records where the user is reading in a conversation, so returning to it can pick up there.
   * Being at the bottom is the position message lists open at anyway, so it's stored as the absence
   * of an entry.
   */
  private saveViewState(viewStateKey: string, messages: ReadonlyArray<SbMessage>) {
    const scrollable = this.scrollableRef.current
    if (!scrollable || this.props.isRestorePending?.(viewStateKey)) {
      return
    }

    const atBottom =
      scrollable.scrollTop + scrollable.clientHeight + AUTOSCROLL_LEEWAY_PX >=
      scrollable.scrollHeight
    const anchor = atBottom ? undefined : captureChatViewAnchor(scrollable, messages)

    if (anchor) {
      chatViewAnchorStore.set(viewStateKey, anchor)
    } else {
      chatViewAnchorStore.delete(viewStateKey)
    }
  }

  override getSnapshotBeforeUpdate(prevProps: MessageListProps) {
    const prevViewStateKey = prevProps.viewStateKey
    if (prevViewStateKey !== undefined && prevViewStateKey !== this.props.viewStateKey) {
      // The DOM still holds the conversation that's being swapped out, so this is both the last
      // chance to read where the user was in it and the only one where the incoming conversation's
      // content can't have clamped the scroll position first.
      this.saveViewState(prevViewStateKey, prevProps.messages)
    }

    if (!this.scrollableRef.current) {
      return { wasAtBottom: true, lastScrollTop: 0, lastScrollHeight: 0 }
    }

    const scrollable = this.scrollableRef.current
    const lastScrollTop = scrollable.scrollTop
    const lastScrollHeight = scrollable.scrollHeight
    const wasAtBottom =
      lastScrollTop + scrollable.clientHeight + AUTOSCROLL_LEEWAY_PX >= lastScrollHeight
    return { wasAtBottom, lastScrollTop, lastScrollHeight }
  }

  override componentDidMount() {
    const scrollable = this.scrollableRef.current
    if (scrollable) {
      scrollable.scrollTop = scrollable.scrollHeight

      if (this.props.onScrollUpdate) {
        this.props.onScrollUpdate(scrollable)
      }
    }
  }

  override componentDidUpdate(
    prevProps: MessageListProps,
    _: never,
    snapshot: MessageListSnapshot,
  ) {
    const scrollable = this.scrollableRef.current
    if (!scrollable) {
      return
    }

    if (
      this.props.viewStateKey !== undefined &&
      prevProps.viewStateKey !== this.props.viewStateKey
    ) {
      // A different conversation's messages have taken this one's place, so nothing of the old
      // viewport carries over and the list starts at the bottom exactly like a fresh mount does.
      // Owners that want it somewhere else move it from the scroll update below, which still runs
      // before anything is painted.
      scrollable.scrollTop = scrollable.scrollHeight
      this.props.onScrollUpdate?.(scrollable)
      return
    }

    if (scrollable.scrollHeight === snapshot.lastScrollHeight) {
      return
    }

    // A window that was swapped out for a different one (rather than having messages added to one
    // of its ends) leaves no previous content to hold in view, so whoever asked for the swap places
    // the viewport instead. This has to come from the explicit generation signal: comparing the
    // arrays' endpoints can't tell a swap from an ordinary append that trimmed the top in the same
    // update, which changes both ends too.
    const messagesReplaced = prevProps.windowGeneration !== this.props.windowGeneration
    // A window detached from the present only ever grows by loading pages, so pinning to the bottom
    // would drag the user past a page that just appeared below them. The previous props matter as
    // much as the current ones: the update that loads the last page is also the one that reattaches
    // the window.
    const detached = prevProps.hasNewerMessages || this.props.hasNewerMessages

    if (!messagesReplaced) {
      if (snapshot.wasAtBottom && !detached) {
        // Auto-scroll
        scrollable.scrollTop = scrollable.scrollHeight
      } else if (
        prevProps.messages.length < this.props.messages.length &&
        prevProps.messages[0] !== this.props.messages[0]
      ) {
        // Inserted elements at the top, maintain scroll position relative to the last top element
        scrollable.scrollTop =
          snapshot.lastScrollTop + scrollable.scrollHeight - snapshot.lastScrollHeight
      }
    }

    if (this.props.onScrollUpdate) {
      this.props.onScrollUpdate(scrollable)
    }
  }

  override render() {
    const {
      messages,
      loading,
      hasMoreHistory,
      hasNewerMessages,
      loadingNewer,
      refreshToken,
      MessageComponent,
      onLoadMoreMessages,
      onLoadNewerMessages,
      showEmptyState = true,
      unreadLineTime,
    } = this.props

    return (
      <Scrollable
        ref={this.scrollableRef}
        className={this.props.className}
        onScroll={this.props.onScrollUpdate ? this.onScroll.handler : undefined}>
        <InfiniteScrollList
          prevLoadingEnabled={true}
          nextLoadingEnabled={true}
          isLoadingPrev={loading}
          isLoadingNext={loadingNewer}
          hasPrevData={hasMoreHistory}
          hasNextData={hasNewerMessages}
          refreshToken={refreshToken}
          onLoadPrevData={onLoadMoreMessages}
          onLoadNextData={onLoadNewerMessages}>
          <PureMessageList
            showEmptyState={showEmptyState}
            messages={messages}
            MessageComponent={MessageComponent}
            unreadLineTime={unreadLineTime}
            hasMoreHistory={hasMoreHistory}
          />
        </InfiniteScrollList>
      </Scrollable>
    )
  }
}
