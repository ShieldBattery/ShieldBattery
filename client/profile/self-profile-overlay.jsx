import React, { PropTypes } from 'react'
import classnames from 'classnames'
import Avatar from '../avatars/avatar.jsx'
import styles from './self-profile-overlay.css'

export default class SelfProfileOverlay extends React.Component {
  static propTypes = {
    user: PropTypes.string.isRequired,
  };

  render() {
    const { className, user, children } = this.props
    const classes = classnames(styles.overlay, className)
    return (<div className={classes}>
      <div className={styles.header}>
        <Avatar className={styles.avatar} user={user} />
        <h3 className={styles.username}>{user}</h3>
      </div>
      <div className={styles.actions}>
        { children }
      </div>
    </div>)
  }
}

export class ProfileAction extends React.Component {
  static propTypes = {
    icon: PropTypes.node.isRequired,
    text: PropTypes.string.isRequired,
    onClick: PropTypes.func.isRequired,
  };

  render() {
    const { icon, text, onClick } = this.props

    return (<div className={styles.action} onClick={onClick}>
      <span className={styles.actionIcon}>{icon}</span>
      <div className={styles.actionText}>{text}</div>
    </div>)
  }
}
