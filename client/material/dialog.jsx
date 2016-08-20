import React from 'react'
import TransitionGroup from 'react-addons-css-transition-group'
import keycode from 'keycode'
import KeyListener from '../keyboard/key-listener.jsx'
import styles from './dialog.css'

const ESCAPE = keycode('esc')

const transitionNames = {
  enter: styles.enter,
  enterActive: styles.enterActive,
  leave: styles.leave,
  leaveActive: styles.leaveActive,
}

class Dialog extends React.Component {
  static propTypes = {
    modal: React.PropTypes.bool,
    onCancel: React.PropTypes.func,
  };

  constructor(props) {
    super(props)
    this._handleKeyDown = ::this.onKeyDown
    this._handleCancel = ::this.onCancel
  }

  render() {
    let child
    if (this.props.children) {
      child = <div key='dialog' className={styles.container}>
          <div className={styles.scrim} onClick={this._handleCancel} />
          { this.props.children }
      </div>
    }
    return (<KeyListener onKeyDown={this.onKeyDown}>
      <TransitionGroup transitionName={transitionNames}
          transitionEnterTimeout={350} transitionLeaveTimeout={250}>
        {child}
      </TransitionGroup>
    </KeyListener>)
  }

  onCancel() {
    if (!this.props.modal && this.props.onCancel) {
      this.props.onCancel()
    }
  }

  onKeyDown = (event) => {
    if (this.props.children && !this.props.modal && event.keyCode === ESCAPE) {
      this.onCancel()
      return true
    }

    return false
  };
}

export default Dialog
