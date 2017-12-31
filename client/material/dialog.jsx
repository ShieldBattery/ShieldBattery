import React from 'react'
import PropTypes from 'prop-types'
import keycode from 'keycode'
import KeyListener from '../keyboard/key-listener.jsx'
import CloseDialogIcon from '../icons/material/ic_close_black_24px.svg'
import IconButton from '../material/icon-button.jsx'
import { ScrollableContent } from '../material/scroll-bar.jsx'
import styles from './dialog.css'

const ESCAPE = keycode('esc')

class Dialog extends React.Component {
  static propTypes = {
    onCancel: PropTypes.func,
    title: PropTypes.string.isRequired,
    showCloseButton: PropTypes.bool,
    buttons: PropTypes.arrayOf(PropTypes.element),
  }

  state = {
    scrolledUp: false,
    scrolledDown: false,
  }

  render() {
    const { title, showCloseButton, buttons } = this.props
    const { scrolledUp, scrolledDown } = this.state

    const closeButton = showCloseButton ? (
      <IconButton
        className={styles.closeButton}
        icon={<CloseDialogIcon />}
        title="Close dialog"
        onClick={this.onCloseButtonClick}
      />
    ) : null

    return (
      <KeyListener onKeyDown={this.onKeyDown}>
        <div role="dialog" className={styles.contents}>
          <div className={styles.titleBar}>
            <h3 className={styles.title}>{title}</h3>
            {closeButton}
          </div>
          {scrolledDown ? <div className={styles.titleDivider} /> : null}
          <ScrollableContent
            autoHeight={true}
            autoHeightMin={'100px'}
            autoHeightMax={'calc(80vh - 132px)'}
            onUpdate={this.onScrollUpdate}>
            <div className={styles.body}>{this.props.children}</div>
          </ScrollableContent>
          {scrolledUp && buttons && buttons.length ? (
            <div className={styles.actionsDivider} />
          ) : null}
          {buttons && buttons.length ? <div className={styles.actions}>{buttons}</div> : null}
        </div>
      </KeyListener>
    )
  }

  onCloseButtonClick = () => {
    if (this.props.onCancel) {
      this.props.onCancel()
    }
  }

  onKeyDown = event => {
    if (this.props.onCancel && event.keyCode === ESCAPE) {
      this.props.onCancel()
      return true
    }

    return false
  }

  onScrollUpdate = values => {
    const { scrollTop, scrollHeight, clientHeight } = values
    const scrolledUp = scrollTop + clientHeight < scrollHeight
    const scrolledDown = scrollTop > 0

    if (scrolledUp !== this.state.scrolledUp || scrolledDown !== this.state.scrolledDown) {
      this.setState({ scrolledUp, scrolledDown })
    }
  }
}

export default Dialog
