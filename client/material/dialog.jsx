import React from 'react'
import TransitionGroup from 'react-addons-css-transition-group'
import keycode from 'keycode'
import styles from './dialog.css'

const transitionNames = {
  enter: styles.enter,
  enterActive: styles.enterActive,
  leave: styles.leave,
  leaveActive: styles.leaveActive,
}

class Dialog extends React.Component {
  static propTypes = {
    onCancel: React.PropTypes.func,
  }

  constructor(props) {
    super(props)
    this._onKeyUp = ::this.onKeyUp
  }

  componentDidMount() {
    window.addEventListener('keyup', this._onKeyUp)
  }

  componentWillUnmount() {
    window.removeEventListener('keyup', this._onKeyUp)
  }

  render() {
    let child
    if (this.props.children) {
      child = <div key='dialog' className={styles.container}>
          <div className={styles.scrim} onClick={::this.onCancel} />
          { this.props.children }
      </div>
    }
    console.dir(transitionNames)
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

  onKeyUp(event) {
    if (!this.props.children) return

    if (event.keyCode === keycode('esc')) {
      this.onCancel()
    }
  }
}

export default Dialog
