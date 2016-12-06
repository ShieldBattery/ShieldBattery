import React, { PropTypes } from 'react'
import keycode from 'keycode'
import styles from './popover.css'

import KeyListener from '../keyboard/key-listener.jsx'
import Portal from './portal.jsx'

const ESCAPE = keycode('esc')
const OPEN_TIME = 300
const CLOSE_TIME = 275
const FAST_OUT_SLOW_IN = 'cubic-bezier(.4, 0, .2, 1)'

export default class Popover extends React.Component {
  static propTypes = {
    open: PropTypes.bool.isRequired,
    onDismiss: PropTypes.func.isRequired,
    children: PropTypes.func.isRequired,
  };

  state = {
    open: this.props.open,
    opening: false,
    closing: false,
    scaleHorizontalStyle: {
      transform: 'scaleX(0.3)',
      transformOrigin: 'right top',
    },
    scaleVerticalStyle: {
      transform: 'scaleY(0.3)',
      transformOrigin: 'right top',
    },
    backgroundStyle: {
      opacity: 0.1,
    },
  };
  openTimer = null;
  closeTimer = null;

  onKeyDown = event => {
    if (event.keyCode !== ESCAPE) return false

    if (this.props.onDismiss && this.state.open && !this.state.closing) {
      this.props.onDismiss()
      return true
    }

    return false
  };

  animateOnOpen = () => {
    this.setState({
      scaleHorizontalStyle: {
        transform: 'scaleX(1)',
        transformOrigin: 'right top',
        transition: `transform 200ms ${FAST_OUT_SLOW_IN}`,
      },
      scaleVerticalStyle: {
        transform: 'scaleY(1)',
        transformOrigin: 'right top',
        transition: `transform 200ms ${FAST_OUT_SLOW_IN} 50ms`,
      },
      backgroundStyle: {
        opacity: 1,
        transition: `opacity 150ms ${FAST_OUT_SLOW_IN}`,
      },
    })
  };

  componentWillReceiveProps(nextProps) {
    if (nextProps.open !== this.state.open) {
      if (nextProps.open) {
        window.requestAnimationFrame(this.animateOnOpen)
        this.setState({
          open: true,
          opening: true,
          closing: false,
        })
        clearTimeout(this.openTimer)
        this.openTimer = setTimeout(() => this.setState({ opening: false }), OPEN_TIME)
        clearTimeout(this.closeTimer)
        this.closeTimer = null
      } else {
        this.setState({
          closing: true,
          scaleHorizontalStyle: {
            transform: 'scaleX(0.3)',
            transformOrigin: 'right top',
            transition: `transform 200ms ${FAST_OUT_SLOW_IN} 75ms`,
          },
          scaleVerticalStyle: {
            transform: 'scaleY(0.3)',
            transformOrigin: 'right top',
            transition: `transform 200ms ${FAST_OUT_SLOW_IN} 25ms`,
          },
          backgroundStyle: {
            opacity: 0.1,
            transition: `opacity 175ms ${FAST_OUT_SLOW_IN} 100ms`,
          },
        })
        clearTimeout(this.closeTimer)
        this.closeTimer =
            setTimeout(() => this.setState({ open: false, closing: false }), CLOSE_TIME)
        clearTimeout(this.openTimer)
        this.openTimer = null
      }
    }
  }

  componentWillUnmount() {
    clearTimeout(this.openTimer)
    clearTimeout(this.closeTimer)
  }


  render() {
    const { onDismiss, children } = this.props
    const { open, opening, closing } = this.state

    const renderChildren = () => {
      let state = {}
      let timings = { openDelay: 0, openDuration: 0, closeDuration: 0 }
      if (open && opening && !closing) {
        state = { opening: true }
        timings = { openDelay: OPEN_TIME, openDuration: OPEN_TIME, closeDuration: 0 }
      } else if (open && !opening && !closing) {
        state = { opened: true }
        timings = { openDelay: 0, openDuration: 0, closeDuration: 0 }
      } else if (open && !opening && closing) {
        state = { closing: true }
        timings = { openDelay: 0, openDuration: 0, closeDuration: CLOSE_TIME }
      }

      return children(state, timings)
    }

    const renderContents = () => {
      if (!open && !closing) return null

      return (<KeyListener onKeyDown={this.onKeyDown}>
        {
          open ?
            <div key={'popover'} className={styles.popover}>
              <div className={styles.scaleHorizontal} style={this.state.scaleHorizontalStyle}>
                <div className={styles.scaleVertical} style={this.state.scaleVerticalStyle}>
                  <div className={styles.background} style={this.state.backgroundStyle} />
                </div>
              </div>
              { renderChildren() }
            </div> :
            null
        }
      </KeyListener>)
    }

    return (<Portal onDismiss={onDismiss} open={open}>
      { renderContents }
    </Portal>)
  }
}
