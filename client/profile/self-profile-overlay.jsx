import React, { PropTypes } from 'react'
import classnames from 'classnames'
import keycode from 'keycode'
import TransitionGroup from 'react-addons-css-transition-group'
import Avatar from '../avatars/avatar.jsx'
import styles from './self-profile-overlay.css'

import KeyListener from '../keyboard/key-listener.jsx'
import MenuItem from '../material/menu/item.jsx'
import Portal from '../material/portal.jsx'

const ESCAPE = keycode('esc')

const transitionNames = {
  appear: styles.enter,
  appearActive: styles.enterActive,
  enter: styles.enter,
  enterActive: styles.enterActive,
  leave: styles.leave,
  leaveActive: styles.leaveActive,
}
const CLOSE_TIME = 275

export default class SelfProfileOverlay extends React.Component {
  static propTypes = {
    open: PropTypes.bool.isRequired,
    user: PropTypes.string.isRequired,
    onDismiss: PropTypes.func.isRequired,
  };

  state = {
    open: this.props.open,
    closing: false,
  };
  closeTimer = null;

  onKeyDown = event => {
    if (event.keyCode !== ESCAPE) return false

    if (this.props.onDismiss && this.state.open && !this.state.closing) {
      this.props.onDismiss()
      return true
    }

    return false
  };

  componentWillReceiveProps(nextProps) {
    if (nextProps.open !== this.state.open) {
      if (nextProps.open) {
        this.setState({
          open: true,
          closing: false,
        })
        clearTimeout(this.closeTimer)
        this.closeTimer = null
      } else {
        this.setState({ closing: true })
        clearTimeout(this.closeTimer)
        this.closeTimer = setTimeout(() => this.setState({ open: false }), CLOSE_TIME)
      }
    }
  }

  componentWillUnmount() {
    clearTimeout(this.closeTimer)
  }


  render() {
    const { className, user, children, onDismiss } = this.props
    const { open, closing } = this.state

    const renderContents = () => {
      if (!open && !closing) return null

      return (<KeyListener onKeyDown={this.onKeyDown}>
        <TransitionGroup
            transitionName={transitionNames} transitionAppear={true}
            transitionAppearTimeout={300} transitionEnterTimeout={300}
            transitionLeaveTimeout={CLOSE_TIME}>
          {
            open && !closing ?
                <SelfProfileContents key={'contents'} className={className} user={user}>
                  {children}
                </SelfProfileContents> :
                null
          }
        </TransitionGroup>
      </KeyListener>)
    }

    return (<Portal onDismiss={onDismiss} open={open}>
      { renderContents }
    </Portal>)
  }
}

export class SelfProfileContents extends React.Component {
  static propTypes = {
    user: PropTypes.string.isRequired,
  };

  render() {
    const { className, user, children } = this.props
    const classes = classnames(styles.overlay, className)
    return (<div className={classes}>
      <div className={styles.scaleHorizontal}>
        <div className={styles.scaleVertical}>
          <div className={styles.background} />
        </div>
      </div>
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
    text: PropTypes.string.isRequired,
    icon: PropTypes.node.isRequired,
    onClick: PropTypes.func,
  };

  state = {
    active: false,
  };

  onMouseEnter = () => {
    this.setState({ active: true })
  };

  onMouseLeave = () => {
    this.setState({ active: false })
  };

  render() {
    const { text, icon, onClick } = this.props
    const { active } = this.state

    return (
      <MenuItem
        text={text}
        icon={icon}
        onClick={onClick}
        active={active}
        onMouseEnter={this.onMouseEnter}
        onMouseLeave={this.onMouseLeave}/>
    )
  }
}
