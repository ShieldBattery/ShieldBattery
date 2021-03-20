import { List } from 'immutable'
import PropTypes from 'prop-types'
import React from 'react'
import styled from 'styled-components'
import { animationFrameHandler } from '../material/animation-frame-handler'
import LoadingIndicator from '../progress/dots'
import { TextMessageDisplay } from './message'
import { ChatMessage, ChatMessageType } from './message-records'
import {
  JoinChannelMessage,
  LeaveChannelMessage,
  NewChannelOwnerMessage,
  SelfJoinChannelMessage,
  UserOfflineMessage,
  UserOnlineMessage,
} from './message-types'

/**
 * How many pixels a user can be away from the bottom of the scrollable area and still be
 * considered "at the bottom" for the purposes of autoscrolling.
 */
const AUTOSCROLL_LEEWAY_PX = 8

const LoadingArea = styled.div`
  display: flex;
  justify-content: center;
  align-items: center;
  height: 32px;
`

const Scrollable = styled.div`
  padding: 8px 16px 0px 8px;
  overflow-y: auto;
`

const Messages = styled.div`
  padding: 8px 0 0;
  user-select: contain;

  & * {
    user-select: text;
  }
`

// TODO(tec27): make this a user setting
const ONLINE_OFFLINE_DISABLED = true

interface PureMessageListProps {
  messages: List<ChatMessage>
}

function messageToElem(msg: ChatMessage) {
  switch (msg.type) {
    case ChatMessageType.JoinChannel:
      return <JoinChannelMessage key={msg.id} record={msg} />
    case ChatMessageType.LeaveChannel:
      return <LeaveChannelMessage key={msg.id} record={msg} />
    case ChatMessageType.TextMessage:
      return <TextMessageDisplay key={msg.id} user={msg.from} time={msg.time} text={msg.text} />
    case ChatMessageType.NewChannelOwner:
      return <NewChannelOwnerMessage key={msg.id} record={msg} />
    case ChatMessageType.SelfJoinChannel:
      return <SelfJoinChannelMessage key={msg.id} record={msg} />
    case ChatMessageType.UserOnline:
      return ONLINE_OFFLINE_DISABLED ? null : <UserOnlineMessage key={msg.id} record={msg} />
    case ChatMessageType.UserOffline:
      return ONLINE_OFFLINE_DISABLED ? null : <UserOfflineMessage key={msg.id} record={msg} />
    default:
      return null
  }
}

// This contains just the messages, to avoid needing to re-render them all if e.g. loading state
// changes on the actual message list
const PureMessageList = React.memo<PureMessageListProps>(({ messages }) => {
  return <Messages>{messages.map(m => messageToElem(m))}</Messages>
})

export interface MessageListProps {
  messages: List<ChatMessage>
  className?: string
  /** Whether we are currently requesting more history for this message list. */
  loading?: boolean
  /** Whether this message list has more history available that could be requested. */
  hasMoreHistory?: boolean
  /**
   * Callback whenever the scroll position or scroll height has been updated (debounced to
   * animation frames).
   */
  onScrollUpdate?: (scrollTarget: EventTarget) => void
}

interface MessageListSnapshot {
  /** Whether the user was scrolled to the bottom of the content before the last update. */
  wasAtBottom: boolean
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

  shouldComponentUpdate(nextProps: MessageListProps) {
    return (
      this.props.messages !== nextProps.messages ||
      this.props.loading !== nextProps.loading ||
      this.props.hasMoreHistory !== nextProps.hasMoreHistory ||
      this.props.onScrollUpdate !== nextProps.onScrollUpdate
    )
  }

  componentWillUnmount() {
    this.onScroll.cancel()
  }

  getSnapshotBeforeUpdate() {
    if (!this.scrollableRef.current) {
      return { wasAtBottom: true, lastScrollHeight: 0 }
    }

    const scrollable = this.scrollableRef.current
    const lastScrollHeight = scrollable.scrollHeight
    const wasAtBottom =
      scrollable.scrollTop + scrollable.clientHeight + AUTOSCROLL_LEEWAY_PX >= lastScrollHeight
    return { wasAtBottom, lastScrollHeight }
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
        scrollable.scrollTop += scrollable.scrollHeight - snapshot.lastScrollHeight
      }
    }

    if (this.props.onScrollUpdate) {
      this.props.onScrollUpdate(scrollable)
    }
  }

  render() {
    const needsLoadingArea = this.props.loading || this.props.hasMoreHistory

    return (
      <Scrollable
        ref={this.scrollableRef}
        className={this.props.className}
        onScroll={this.props.onScrollUpdate ? this.onScroll.handler : undefined}>
        {needsLoadingArea ? (
          <LoadingArea>{this.props.loading ? <LoadingIndicator /> : null}</LoadingArea>
        ) : null}
        <PureMessageList messages={this.props.messages} />
      </Scrollable>
    )
  }
}
