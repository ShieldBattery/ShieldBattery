import React, { PropTypes } from 'react'
import styles from './message.css'

import Avatar from '../avatars/avatar.jsx'

const localeTimeSupported = !!Date.prototype.toLocaleTimeString
function getLocalTime(date) {
  if (localeTimeSupported) {
    return date.toLocaleTimeString(navigator.language, { hour: 'numeric', minute: '2-digit' })
  }

  // Internationalization isn't supported, so we'll just format to American time. DEAL WITH IT.
  let hour = date.getHours()
  const isPm = hour >= 12
  hour = isPm ? (hour - 12) : hour
  if (hour === 0) {
    hour = 12
  }
  let minute = '' + date.getMinutes()
  if (minute.length === 1) {
    minute = '0' + minute
  }
  return hour + ':' + minute + ' ' + (isPm ? 'PM' : 'AM')
}

export default class ChatMessage extends React.Component {
  static propTypes = {
    user: PropTypes.string.isRequired,
    time: PropTypes.number.isRequired,
    text: PropTypes.string.isRequired,
    avatarImage: PropTypes.string,
  };

  render() {
    const { user, time, text, avatarImage } = this.props
    const timeStr = getLocalTime(new Date(time))

    return (<div className={styles.message}>
      <Avatar className={styles.avatar} user={user} image={avatarImage} />
      <div className={styles.content}>
        <div className={styles.metadata}>
          <span className={styles.username}>{user}</span>
          <span className={styles.timestamp}>{timeStr}</span>
        </div>
        <span className={styles.text}>{text}</span>
      </div>
    </div>)
  }
}
