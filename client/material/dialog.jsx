import React from 'react'
import TransitionGroup from 'react-addons-css-transition-group'
import keycode from 'keycode'
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
    onCancel: React.PropTypes.func,
  };

  constructor(props) {
    super(props)
    this._handleKeyDown = ::this.onKeyDown
    this._handleCancel = ::this.onCancel
  }

  componentDidMount() {
    window.addEventListener('keydown', this._handleKeyDown)
  }

  componentWillUnmount() {
    window.removeEventListener('keydown', this._handleKeyDown)
  }

  render() {
    let child
    if (this.props.children) {
      child = <div key='dialog' className={styles.container}>
          <div className={styles.scrim} onClick={this._handleCancel} />
          { this.props.children }
      </div>
    }
    return (
      <TransitionGroup transitionName={transitionNames}
          transitionEnterTimeout={350} transitionLeaveTimeout={250}>
        {child}
      </TransitionGroup>
    )
  }

  onCancel() {
    if (this.props.onCancel) {
      this.props.onCancel()
    }
  }

  onKeyDown(event) {
    if (!this.props.children) return

    if (event.keyCode === ESCAPE) {
      this.onCancel()
    }
  }
}

export default Dialog
