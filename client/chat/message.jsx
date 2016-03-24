import React, { PropTypes } from 'react'
import styles from './message.css'

import Avatar from '../avatars/avatar.jsx'
import Timestamp from './timestamp.jsx'

export default class ChatMessage extends React.Component {
  static propTypes = {
    user: PropTypes.string.isRequired,
    time: PropTypes.number.isRequired,
    text: PropTypes.string.isRequired,
    avatarImage: PropTypes.string,
  };

  render() {
    const { user, time, text, avatarImage } = this.props

    return (<div className={styles.message}>
      <Avatar className={styles.avatar} user={user} image={avatarImage} />
      <div className={styles.content}>
        <div className={styles.metadata}>
          <span className={styles.username}>{user}</span>
          <Timestamp time={time} />
        </div>
        <span className={styles.text}>{text}</span>
      </div>
    </div>)
  }
}
