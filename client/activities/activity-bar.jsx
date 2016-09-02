import React, { PropTypes } from 'react'
import keycode from 'keycode'
import KeyListener from '../keyboard/key-listener.jsx'
import styles from './activity-bar.css'

import AvatarButton from '../avatars/avatar-button.jsx'

const C = keycode('c')
const J = keycode('j')
const S = keycode('s')

export default class ActivityBar extends React.Component {
  static propTypes = {
    onAvatarClick: PropTypes.func.isRequired,
    avatarTitle: PropTypes.string.isRequired,
    user: PropTypes.string.isRequired,
    onCreateLobbyHotkey: PropTypes.func.isRequired,
    onJoinLobbyHotkey: PropTypes.func.isRequired,
    onSettingsHotkey: PropTypes.func.isRequired,
  };

  render() {
    const { user, avatarTitle, onAvatarClick } = this.props

    return (<KeyListener onKeyDown={this.onKeyDown}>
      <div className={styles.activityBar}>
        <AvatarButton className={styles.avatarButton} avatarClassName={styles.avatar} user={user}
            title={avatarTitle} onClick={onAvatarClick} />
        {this.props.children}
      </div>
    </KeyListener>)
  }

  onKeyDown = event => {
    if (this.props.onCreateLobbyHotkey && event.keyCode === C && event.altKey) {
      this.props.onCreateLobbyHotkey()
      return true
    } else if (this.props.onJoinLobbyHotkey && event.keyCode === J && event.altKey) {
      this.props.onJoinLobbyHotkey()
      return true
    } else if (this.props.onSettingsHotkey && event.keyCode === S && event.altKey) {
      this.props.onSettingsHotkey()
      return true
    }

    return false
  };
}
