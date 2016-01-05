import React, { PropTypes } from 'react'
import styles from './message.css'

import Avatar from '../avatars/avatar.jsx'

export default class ChatMessage extends React.Component {
  static propTypes = {
    user: PropTypes.string.isRequired,
    timestamp: PropTypes.string.isRequired,
    text: PropTypes.string.isRequired,
    avatarImage: PropTypes.string,
  }

  render() {
    const { user, timestamp, text, avatarImage } = this.props

    return (<div className={styles.message}>
      <Avatar user={user} image={avatarImage} />
      <div className={styles.content}>
        <div className={styles.metadata}>
          <span className={styles.username}>{user}</span>
          <span className={styles.timestamp}>{timestamp}</span>
        </div>
        <span className={styles.text}>{text}</span>
      </div>
    </div>)
  }
}
