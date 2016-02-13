import React, { PropTypes } from 'react'
import styles from './activity-bar.css'

import AvatarButton from '../avatars/avatar-button.jsx'
import Menu from '../material/menu.jsx'
import { MenuItem } from '../material/common/menu-utils.jsx'

export default class ActivityBar extends React.Component {
  static propTypes = {
    onLogoutClick: PropTypes.func.isRequired,
    avatarTitle: PropTypes.string.isRequired,
    user: PropTypes.string.isRequired,
  };

  render() {
    const { user, avatarTitle, onLogoutClick } = this.props
    const avatar = <AvatarButton className={styles.avatarButton} avatarClassName={styles.avatar}
        user={user} title={avatarTitle} />
    const origin = { horizontal: 'right', vertical: 'top' }

    return (<div className={styles.activityBar}>
      <Menu element={avatar} origin={origin}>
        <MenuItem text='Menu item 1' onClick={() => console.log('Do menu 1 action')} />
        <MenuItem text='Menu item 2' onClick={() => console.log('Do menu 2 action')} />
        <MenuItem text='Menu item 3' onClick={() => console.log('Do menu 3 action')} />
        <MenuItem text='Log out' onClick={onLogoutClick} />
      </Menu>
      {this.props.children}
    </div>)
  }
}
