import { List } from 'immutable'
import React, { ReactNode } from 'react'
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
import { BlockedMessage, NewDayMessage, TextMessage } from './common-message-layout'
import { CommonMessageType, NewDayMessageRecord, SbMessage } from './message-records'

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

function renderCommonMessage(
  msg: SbMessage,
  selfUserId: SbUserId,
  blockedUsers: ReadonlyDeep<Map<SbUserId, UserRelationshipJson>>,
) {
  switch (msg.type) {
    case CommonMessageType.NewDayMessage:
      return <NewDayMessage key={msg.id} time={msg.time} />
    // TODO(2Pac): Reconcile these types into one when everything is moved to immer
    case CommonMessageType.TextMessage:
    case ServerChatMessageType.TextMessage:
      // TODO(tec27): Would probably be nice to collect adjacent blocked messages into a single
      // item?
      return blockedUsers.has(msg.from) ? (
        <BlockedMessage
          key={msg.id}
          msgId={msg.id}
          userId={msg.from}
          selfUserId={selfUserId}
          time={msg.time}
          text={msg.text}
        />
      ) : (
        <TextMessage
          key={msg.id}
          msgId={msg.id}
          userId={msg.from}
          selfUserId={selfUserId}
          time={msg.time}
          text={msg.text}
        />
      )
    default:
      return null
  }
}

const handleUnknown = (msg: SbMessage) => {
  return null
}

// TODO(2Pac): Inline this when all messaging related components have been moved to immer
function getMessagesLength(messages: List<SbMessage> | ReadonlyArray<SbMessage>): number {
  if (Array.isArray(messages)) {
    return messages.length
  } else {
    return (messages as List<SbMessage>).size
  }
}

// TODO(2Pac): Inline this when all messaging related components have been moved to immer
function getMessageAtIndex(
  messages: List<SbMessage> | ReadonlyArray<SbMessage>,
  index: number,
): SbMessage | undefined {
  if (Array.isArray(messages)) {
    return messages[index]
  } else {
    return (messages as List<SbMessage>).get(index)
  }
}

interface PureMessageListProps {
  messages: List<SbMessage> | ReadonlyArray<SbMessage>
  renderMessage?: (
    msg: SbMessage,
    blockedUsers: ReadonlyDeep<Map<SbUserId, UserRelationshipJson>>,
  ) => ReactNode
}

// This contains just the messages, to avoid needing to re-render them all if e.g. loading state
// changes on the actual message list
const PureMessageList = React.memo<PureMessageListProps>(({ messages, renderMessage }) => {
  const { t } = useTranslation()
  const selfUserId = useSelfUser()!.id
  const blocks = useAppSelector(s => s.relationships.blocks)

  const messagesLength = getMessagesLength(messages)
  if (messagesLength < 1) {
    return <EmptyList>{t('common.lists.empty', 'Nothing to see here')}</EmptyList>
  }

  return (
    <Messages>
      {messages.map((m, index) => {
        // NOTE(2Pac): We only handle common messages here, e.g. text message. All other types of
        // messages are handled by calling the `renderMessage` function which should be supplied by
        // each service if they have any special messages to handle.
        const messageLayout =
          renderCommonMessage(m, selfUserId, blocks) ?? (renderMessage ?? handleUnknown)(m, blocks)

        const prevMessage = index > 0 ? getMessageAtIndex(messages, index - 1) : null
        if (!prevMessage || isSameDay(new Date(prevMessage.time), new Date(m.time))) {
          return messageLayout
        } else {
          const newDayMessageRecord = new NewDayMessageRecord({
            id: m.time + '-' + CommonMessageType.NewDayMessage,
            time: m.time,
          })

          return [renderCommonMessage(newDayMessageRecord, selfUserId, blocks), messageLayout]
        }
      })}
    </Messages>
  )
})

export interface MessageListProps {
  messages: List<SbMessage> | ReadonlyArray<SbMessage>
  /**
   * Function which will be called to render a particular message. If not provided, only common
   * messages will be rendered.
   */
  renderMessage?: (msg: SbMessage) => ReactNode
  className?: string
  /** Whether we are currently requesting more history for this message list. */
  loading?: boolean
  /** Whether this message list has more history available that could be requested. */
  hasMoreHistory?: boolean
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
  }

  override getSnapshotBeforeUpdate() {
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
    if (!scrollable || scrollable.scrollHeight === snapshot.lastScrollHeight) {
      return
    }

    if (snapshot.wasAtBottom) {
      // Auto-scroll
      scrollable.scrollTop = scrollable.scrollHeight
    } else if (prevProps.messages !== this.props.messages) {
      if (
        getMessagesLength(prevProps.messages) < getMessagesLength(this.props.messages) &&
        getMessageAtIndex(prevProps.messages, 0) !== getMessageAtIndex(this.props.messages, 0)
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
    const { messages, loading, hasMoreHistory, refreshToken, renderMessage, onLoadMoreMessages } =
      this.props

    return (
      <Scrollable
        ref={this.scrollableRef}
        className={this.props.className}
        onScroll={this.props.onScrollUpdate ? this.onScroll.handler : undefined}>
        <InfiniteScrollList
          prevLoadingEnabled={true}
          isLoadingPrev={loading}
          hasPrevData={hasMoreHistory}
          refreshToken={refreshToken}
          onLoadPrevData={onLoadMoreMessages}>
          <PureMessageList messages={messages} renderMessage={renderMessage} />
        </InfiniteScrollList>
      </Scrollable>
    )
  }
}
