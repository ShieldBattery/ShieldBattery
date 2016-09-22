import React, { PropTypes } from 'react'
import Entry from '../material/left-nav/entry.jsx'
import IconButton from '../material/icon-button.jsx'
import CloseIcon from '../icons/material/ic_close_black_24px.svg'
import styles from './channel.css'

export default class ChatNavEntry extends React.Component {
  static propTypes = {
    channel: PropTypes.string.isRequired,
    currentPath: PropTypes.string.isRequired,
    hasUnread: PropTypes.bool,
    onLeave: PropTypes.func.isRequired,
  };

  render() {
    const { channel, currentPath, hasUnread } = this.props
    const button = <IconButton className={styles.navLeaveButton} icon={<CloseIcon />}
        title='Leave channel' onClick={this.onLeaveClick} />

    return (
      <Entry link={`/chat/${encodeURIComponent(channel)}`} currentPath={currentPath}
          needsAttention={hasUnread} button={channel !== 'ShieldBattery' ? button : null}>
        #{channel}
      </Entry>
    )
  }

  onLeaveClick = () => {
    this.props.onLeave(this.props.channel)
  };
}
