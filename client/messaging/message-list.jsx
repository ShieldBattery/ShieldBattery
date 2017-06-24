import React, { PropTypes } from 'react'
import styles from './message.css'

import { ChatMessage } from './message.jsx'
import {
  JoinChannelMessage,
  LeaveChannelMessage,
  NewChannelOwnerMessage,
  SelfJoinChannelMessage,
  UserOnlineMessage,
  UserOfflineMessage
} from './message-types.jsx'
import { ScrollableContent } from '../material/scroll-bar.jsx'
import LoadingIndicator from '../progress/dots.jsx'

// This contains just the messages, to avoid needing to re-render them all if e.g. loading state
// changes on the actual message list
class PureMessageList extends React.Component {
  shouldComponentUpdate(nextProps) {
    return this.props.messages !== nextProps.messages
  }

  renderMessage(msg) {
    const { id, type } = msg
    switch (type) {
      case 'joinChannel': return <JoinChannelMessage key={id} record={msg} />
      case 'leaveChannel': return <LeaveChannelMessage key={id} record={msg} />
      case 'message':
        return <ChatMessage key={id} user={msg.from} time={msg.time} text={msg.text} />
      case 'newOwner': return <NewChannelOwnerMessage key={id} record={msg} />
      case 'selfJoinChannel': return <SelfJoinChannelMessage key={id} record={msg} />
      case 'userOnline': return <UserOnlineMessage key={id} record={msg} />
      case 'userOffline': return <UserOfflineMessage key={id} record={msg} />
      default: return null
    }
  }

  render() {
    return (<div className={styles.messages}>
      { this.props.messages.map(msg => this.renderMessage(msg)) }
    </div>)
  }
}

export default class MessageList extends React.Component {
  static propTypes = {
    messages: PropTypes.object.isRequired,
    // Whether we are currently requesting more history for this message list
    loading: PropTypes.bool,
    // Whether this message list has more history available that could be requested
    hasMoreHistory: PropTypes.bool,
    onScrollUpdate: PropTypes.func,
  };

  constructor(props) {
    super(props)

    this.scrollable = null
    this._setScrollableRef = elem => { this.scrollable = elem }
  }

  shouldComponentUpdate(nextProps) {
    return (
      this.props.messages !== nextProps.messages ||
      this.props.loading !== nextProps.loading ||
      this.props.hasMoreHistory !== nextProps.hasMoreHistory ||
      this.props.onScrollUpdate !== nextProps.onScrollUpdate
    )
  }

  renderLoadingArea() {
    if (!this.props.loading && !this.props.hasMoreHistory) {
      // TODO(tec27): Render something telling users they've reached the beginning
      return null
    }

    return (<div className={styles.loadingArea}>
      { this.props.loading ? <LoadingIndicator /> : null }
    </div>)
  }

  render() {
    return (<ScrollableContent
      ref={this._setScrollableRef}
      autoScroll={true}
      onUpdate={this.props.onScrollUpdate}
      className={styles.messagesScrollable}
      viewClassName={styles.messagesScrollableView}>
      { this.renderLoadingArea() }
      <PureMessageList messages={this.props.messages} />
    </ScrollableContent>)
  }

  // Set a flag that indicates whether or not we are inserting content at the top of the scrollable
  // list. This allows us to better decide how to adjust scroll position (e.g. to try and keep the
  // same top element visible or not)
  setInsertingAtTop(insertingAtTop) {
    this.scrollable.setInsertingAtTop(insertingAtTop)
  }
}
