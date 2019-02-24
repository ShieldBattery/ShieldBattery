import React from 'react'
import PropTypes from 'prop-types'
import CloseWhisperIcon from '../icons/material/ic_close_black_24px.svg'
import Entry from '../material/left-nav/entry.jsx'
import IconButton from '../material/icon-button.jsx'
import styles from './whisper.css'

export default class WhisperNavEntry extends React.Component {
  static propTypes = {
    user: PropTypes.string.isRequired,
    currentPath: PropTypes.string.isRequired,
    onClose: PropTypes.func.isRequired,
    hasUnread: PropTypes.bool,
  }

  render() {
    const { user, currentPath, hasUnread } = this.props
    const button = (
      <IconButton
        className={styles.navCloseButton}
        icon={<CloseWhisperIcon />}
        title='Close whisper'
        onClick={this.onClose}
      />
    )

    return (
      <Entry
        link={`/whispers/${encodeURIComponent(user)}`}
        currentPath={currentPath}
        button={button}
        needsAttention={hasUnread}>
        {user}
      </Entry>
    )
  }

  onClose = () => {
    this.props.onClose(this.props.user)
  }
}
