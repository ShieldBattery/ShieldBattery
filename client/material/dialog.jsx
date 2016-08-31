import React, { PropTypes } from 'react'
import keycode from 'keycode'
import KeyListener from '../keyboard/key-listener.jsx'
import { ScrollableContent } from '../material/scroll-bar.jsx'
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

  state = {
    scrolledUp: false,
    scrolledDwon: false,
  };

  render() {
    const { title, showCloseButton, buttons } = this.props
    const { scrolledUp, scrolledDown } = this.state
    return (<KeyListener onKeyDown={this.onKeyDown}>
      <div key='dialog' className={styles.container}>
        <div className={styles.scrim} onClick={this.onCancel} />
          <div role='dialog' className={styles.contents}>
            <h3 className={styles.title}>{title}</h3>
            { showCloseButton ? <span>X</span> : null }
            { scrolledDown ? <div className={styles.titleDivider} /> : null }
            <ScrollableContent autoHeight={true} autoHeightMin={'100px'}
                autoHeightMax={'calc(80vh - 132px)'} onUpdate={this.onScrollUpdate}>
              <div className={styles.body}>
                { this.props.children }
              </div>
            </ScrollableContent>
            { scrolledUp ? <div className={styles.actionsDivider} /> : null }
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

  onScrollUpdate = values => {
    const { scrollTop, scrollHeight, clientHeight } = values
    const scrolledUp = scrollTop + clientHeight < scrollHeight
    const scrolledDown = scrollTop > 0

    if (scrolledUp !== this.state.scrolledUp || scrolledDown !== this.state.scrolledDown) {
      this.setState({ scrolledUp, scrolledDown })
    }
  };
}

export default Dialog
