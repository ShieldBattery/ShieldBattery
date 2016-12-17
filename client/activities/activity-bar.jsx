import React, { PropTypes } from 'react'
import styles from './activity-bar.css'

import AvatarButton from '../avatars/avatar-button.jsx'

export default class ActivityBar extends React.Component {
  static propTypes = {
    onAvatarClick: PropTypes.func.isRequired,
    avatarTitle: PropTypes.string.isRequired,
    user: PropTypes.string.isRequired,
    avatarButtonRef: PropTypes.func,
  };

  render() {
    const { user, avatarTitle, onAvatarClick, avatarButtonRef } = this.props

    return (<div className={styles.activityBar}>
      <AvatarButton className={styles.avatarButton} avatarClassName={styles.avatar} user={user}
          title={avatarTitle} buttonRef={avatarButtonRef} onClick={onAvatarClick} />
      {this.props.children}
    </div>)
  }
}
