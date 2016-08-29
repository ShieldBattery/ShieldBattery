import React, { PropTypes } from 'react'
import keycode from 'keycode'
import KeyListener from '../keyboard/key-listener.jsx'
import styles from './dialog.css'

const ESCAPE = keycode('esc')

class Dialog extends React.Component {
  static propTypes = {
    modal: PropTypes.bool,
    onCancel: PropTypes.func,
    title: PropTypes.string.isRequired,
    showCloseButton: PropTypes.bool,
    buttons: PropTypes.arrayOf(PropTypes.element),
  };

  render() {
    const { title, showCloseButton, buttons } = this.props
    return (<KeyListener onKeyDown={this.onKeyDown}>
      <div key='dialog' className={styles.container}>
        <div className={styles.scrim} onClick={this.onCancel} />
          <div role='dialog' className={styles.contents}>
            <h3 className={styles.title}>{title}</h3>
            { showCloseButton ? <span>X</span> : null }
            <div className={styles.body}>
              { this.props.children }
            </div>
            <div className={styles.actions}>
              {buttons}
            </div>
          </div>
      </div>
    </KeyListener>)
  }

  onCancel = () => {
    if (!this.props.modal && this.props.onCancel) {
      this.props.onCancel()
    }
  };

  onKeyDown = event => {
    if (this.props.onCancel && !this.props.modal && event.keyCode === ESCAPE) {
      this.props.onCancel()
      return true
    }

    return false
  };
}

export default Dialog
