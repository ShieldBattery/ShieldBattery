import React, { PropTypes } from 'react'
import styles from './message.css'

import { ChatMessageLayout, InfoMessageLayout } from './message.jsx'

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
        <span className={styles.systemImportant}>{user}</span> has joined the channel
      </span>
    </ChatMessageLayout>)
  }
}

export class LeaveChannelMessage extends BaseMessage {
  render() {
    const { time, user } = this.props.record
    return (<ChatMessageLayout time={time} className={styles.systemMessage}>
      <span>
        <span className={styles.systemImportant}>{user}</span> has left the channel
      </span>
    </ChatMessageLayout>)
  }
}

export class NewChannelOwnerMessage extends BaseMessage {
  render() {
    const { time, newOwner } = this.props.record
    return (<ChatMessageLayout time={time} className={styles.systemMessage}>
      <span>
        <span className={styles.systemImportant}>{newOwner}</span> is the new owner of the channel
      </span>
    </ChatMessageLayout>)
  }
}

export class SelfJoinChannelMessage extends BaseMessage {
  render() {
    const { channel } = this.props.record
    return (<InfoMessageLayout className={styles.infoMessage}>
      <span>
        You joined <span className={styles.infoImportant}>#{channel}</span>
      </span>
    </InfoMessageLayout>)
  }
}

export class UserOnlineMessage extends BaseMessage {
  render() {
    const { time, user } = this.props.record
    return (<ChatMessageLayout time={time} className={styles.systemMessage}>
      <span>
        &gt;&gt; <span className={styles.systemImportant}>{user}</span> has come online
      </span>
    </ChatMessageLayout>)
  }
}

export class UserOfflineMessage extends BaseMessage {
  render() {
    const { time, user } = this.props.record
    return (<ChatMessageLayout time={time} className={styles.systemMessage}>
      <span>
        &lt;&lt; <span className={styles.systemImportant}>{user}</span> has gone offline
      </span>
    </ChatMessageLayout>)
  }
}
