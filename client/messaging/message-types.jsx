import React, { PropTypes } from 'react'
import styles from './message.css'

import { ChatMessageLayout } from './message.jsx'

class BaseMessage extends React.Component {
  static propTypes = {
    record: PropTypes.object.isRequired,
  };

  shouldComponentUpdate(nextProps) {
    return this.record !== nextProps.record
  }
}

export class JoinChannelMessage extends BaseMessage {
  render() {
    const { time, user } = this.props.record
    return (<ChatMessageLayout time={time} className={styles.systemMessage}>
      <span>
        <span className={styles.important}>{user}</span> has joined the channel
      </span>
    </ChatMessageLayout>)
  }
}

export class LeaveChannelMessage extends BaseMessage {
  render() {
    const { time, user } = this.props.record
    return (<ChatMessageLayout time={time} className={styles.systemMessage}>
      <span>
        <span className={styles.important}>{user}</span> has left the channel
      </span>
    </ChatMessageLayout>)
  }
}

export class NewChannelOwnerMessage extends BaseMessage {
  render() {
    const { time, newOwner } = this.props.record
    // TODO(2Pac): change the design of the message maybe? So it doesn't look the same as
    // online/offline messages
    return (<ChatMessageLayout time={time} className={styles.systemMessage}>
      <span>
        <span className={styles.important}>{newOwner}</span> is the new owner of the channel
      </span>
    </ChatMessageLayout>)
  }
}

export class UserOnlineMessage extends BaseMessage {
  render() {
    const { time, user } = this.props.record
    return (<ChatMessageLayout time={time} className={styles.systemMessage}>
      <span>
        &gt;&gt; <span className={styles.important}>{user}</span> has come online
      </span>
    </ChatMessageLayout>)
  }
}

export class UserOfflineMessage extends BaseMessage {
  render() {
    const { time, user } = this.props.record
    return (<ChatMessageLayout time={time} className={styles.systemMessage}>
      <span>
        &lt;&lt; <span className={styles.important}>{user}</span> has gone offline
      </span>
    </ChatMessageLayout>)
  }
}
