import React from 'react'
import PropTypes from 'prop-types'
import classnames from 'classnames'
import styles from './message.css'

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

export const ChatTimestamp =
    props => <span className={styles.timestamp}>{getLocalTime(new Date(props.time))}</span>
ChatTimestamp.propTypes = {
  time: PropTypes.number.isRequired,
}

export const ChatMessageLayout = props => {
  const classes = classnames(styles.message, props.className)
  return (<div className={classes}>
    <ChatTimestamp time={props.time}/>
    {props.children}
  </div>)
}
ChatMessageLayout.propTypes = {
  time: PropTypes.number.isRequired,
  className: PropTypes.string,
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

export const InfoMessageLayout = props => {
  const classes = classnames(styles.message, props.className)
  return (<div className={classes}>
    <hr className={styles.infoDividerLeft} />
    { props.children }
    <hr className={styles.infoDividerRight} />
  </div>)
}
InfoMessageLayout.propTypes = {
  className: PropTypes.string,
}
