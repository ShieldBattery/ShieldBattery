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
