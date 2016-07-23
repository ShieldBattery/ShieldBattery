import React, { PropTypes } from 'react'
import styles from './message.css'

import { ChatMessageLayout } from './message-layout.jsx'

class BaseMessage extends React.Component {
  static propTypes = {
    record: PropTypes.object.isRequired,
  };

  shouldComponentUpdate(nextProps) {
    return this.record !== nextProps.record
  }
}

export class ChatMessage extends React.Component {
  static propTypes = {
    user: PropTypes.string.isRequired,
    time: PropTypes.number.isRequired,
    text: PropTypes.string.isRequired,
  };

  shouldComponentUpdate(nextProps) {
    return (nextProps.user !== this.props.user ||
      nextProps.time !== this.props.time ||
      nextProps.text !== this.props.text)
  }

  render() {
    const { user, time, text } = this.props

    return (<ChatMessageLayout time={time}>
      <span className={styles.username}>{user}</span>
      <span className={styles.text}>{text}</span>
    </ChatMessageLayout>)
  }
}

export class JoinMessage extends React.Component {
  static propTypes = {
    time: PropTypes.number.isRequired,
    name: PropTypes.string.isRequired,
  };

  render() {
    return (<ChatMessageLayout time={this.props.time} className={styles.systemMessage}>
      <span>
        &gt;&gt; <span className={styles.important}>{this.props.name}</span> has joined the
        lobby
      </span>
    </ChatMessageLayout>)
  }
}

export class LeaveMessage extends React.Component {
  static propTypes = {
    time: PropTypes.number.isRequired,
    name: PropTypes.string.isRequired,
  };

  render() {
    return (<ChatMessageLayout time={this.props.time} className={styles.systemMessage}>
      <span>
        &lt;&lt; <span className={styles.important}>{this.props.name}</span> has left the
        lobby
      </span>
    </ChatMessageLayout>)
  }
}

export class SelfJoinMessage extends React.Component {
  static propTypes = {
    time: PropTypes.number.isRequired,
    lobby: PropTypes.string.isRequired,
    host: PropTypes.string.isRequired,
  };

  render() {
    return (<ChatMessageLayout time={this.props.time} className={styles.systemMessage}>
        <span>
          You have joined <span className={styles.important}>{this.props.lobby}</span>. The host
          is <span className={styles.important}>{this.props.host}</span>.
        </span>
    </ChatMessageLayout>)
  }
}

export class HostChangeMessage extends React.Component {
  static propTypes = {
    time: PropTypes.number.isRequired,
    name: PropTypes.string.isRequired,
  };

  render() {
    return (<ChatMessageLayout time={this.props.time} className={styles.systemMessage}>
        <span>
          <span className={styles.important}>{this.props.name}</span> is now the host
        </span>
    </ChatMessageLayout>)
  }
}

export class CountdownStartedMessage extends React.Component {
  static propTypes = {
    time: PropTypes.number.isRequired,
  };

  render() {
    return (<ChatMessageLayout time={this.props.time} className={styles.systemMessage}>
        <span>The game countdown has begun</span>
    </ChatMessageLayout>)
  }
}

export class CountdownTickMessage extends React.Component {
  static propTypes = {
    time: PropTypes.number.isRequired,
    timeLeft: PropTypes.number.isRequired,
  };

  render() {
    return (<ChatMessageLayout time={this.props.time} className={styles.systemMessage}>
        <span>{this.props.timeLeft}&hellip;</span>
    </ChatMessageLayout>)
  }
}

export class CountdownCanceledMessage extends React.Component {
  static propTypes = {
    time: PropTypes.number.isRequired,
  };

  render() {
    return (<ChatMessageLayout time={this.props.time} className={styles.systemMessage}>
        <span>The game countdown has been canceled</span>
    </ChatMessageLayout>)
  }
}

export class LoadingCanceledMessage extends React.Component {
  static propTypes = {
    time: PropTypes.number.isRequired,
  };

  // TODO(tec27): We really need to pass a reason back here
  render() {
    return (<ChatMessageLayout time={this.props.time} className={styles.systemMessage}>
        <span>Game initialization has been canceled</span>
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
