import { List } from 'immutable'
import PropTypes from 'prop-types'
import React, { ReactNode } from 'react'
import styled from 'styled-components'
import InfiniteScrollList from '../lists/infinite-scroll-list'
import { animationFrameHandler } from '../material/animation-frame-handler'
import { NewDayMessage, TextMessageDisplay } from './common-message-layout'
import { CommonMessageType, Message, NewDayMessageRecord } from './message-records'

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

const Messages = styled.div`
  user-select: contain;

  & * {
    user-select: text;
  }
`

interface PureMessageListProps {
  messages: List<Message>
  renderMessage?: (msg: Message) => ReactNode
}

function renderCommonMessage(msg: Message) {
  switch (msg.type) {
    case CommonMessageType.NewDayMessage:
      return <NewDayMessage key={msg.id} time={msg.time} />
    case CommonMessageType.TextMessage:
      return <TextMessageDisplay key={msg.id} user={msg.from} time={msg.time} text={msg.text} />
    default:
      return null
  }
}

const handleUnknown = (msg: Message) => {
  return null
}

// This contains just the messages, to avoid needing to re-render them all if e.g. loading state
// changes on the actual message list
const PureMessageList = React.memo<PureMessageListProps>(({ messages, renderMessage }) => {
  return (
    <Messages>
      {messages.map((m, index) => {
        // NOTE(2Pac): We only handle common messages here, e.g. text message. All other types of
        // messages are handled by calling the `renderMessage` function which should be supplied by
        // each service if they have any special messages to handle.
        const messageLayout = renderCommonMessage(m) ?? (renderMessage ?? handleUnknown)(m)

        const prevMessage = index > 0 ? messages.get(index - 1) : null
        if (!prevMessage || isSameDay(new Date(prevMessage.time), new Date(m.time))) {
          return messageLayout
        } else {
          const newDayMessageRecord = new NewDayMessageRecord({
            id: m.time + '-' + CommonMessageType.NewDayMessage,
            time: m.time,
          })

          return [renderCommonMessage(newDayMessageRecord), messageLayout]
        }
      })}
    </Messages>
  )
})

export interface MessageListProps {
  messages: List<Message>
  /**
   * Function which will be called to render a particular message. If not provided, only common
   * messages will be rendered.
   */
  renderMessage?: (msg: Message) => ReactNode
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

export default class MessageList extends React.Component<
  MessageListProps,
  never,
  MessageListSnapshot
> {
  static propTypes = {
    messages: PropTypes.object.isRequired,
    // A function which is used to render messages
    renderMessage: PropTypes.func,
    // Whether we are currently requesting more history for this message list
    loading: PropTypes.bool,
    // Whether this message list has more history available that could be requested
    hasMoreHistory: PropTypes.bool,
    onScrollUpdate: PropTypes.func,
  }

  private scrollableRef = React.createRef<HTMLDivElement>()
  private onScroll = animationFrameHandler(target => {
    if (target && this.props.onScrollUpdate) {
      this.props.onScrollUpdate(target)
    }
  })

  componentWillUnmount() {
    this.onScroll.cancel()
  }

  getSnapshotBeforeUpdate() {
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

  componentDidMount() {
    const scrollable = this.scrollableRef.current
    if (scrollable) {
      scrollable.scrollTop = scrollable.scrollHeight

      if (this.props.onScrollUpdate) {
        this.props.onScrollUpdate(scrollable)
      }
    }
  }

  componentDidUpdate(prevProps: MessageListProps, _: never, snapshot: MessageListSnapshot) {
    const scrollable = this.scrollableRef.current
    if (!scrollable || scrollable.scrollHeight === snapshot.lastScrollHeight) {
      return
    }

    if (snapshot.wasAtBottom) {
      // Auto-scroll
      scrollable.scrollTop = scrollable.scrollHeight
    } else if (prevProps.messages !== this.props.messages) {
      if (
        prevProps.messages.size < this.props.messages.size &&
        prevProps.messages.first() !== this.props.messages.first()
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

  render() {
    const {
      messages,
      loading,
      hasMoreHistory,
      refreshToken,
      renderMessage,
      onLoadMoreMessages,
    } = this.props

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
