import React from 'react'
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

const Timestamp =
    props => <span className={styles.timestamp}>{getLocalTime(new Date(props.time))}</span>
Timestamp.propTypes = {
  time: React.PropTypes.number.isRequired,
}

export default Timestamp
