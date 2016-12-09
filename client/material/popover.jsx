import React, { PropTypes } from 'react'
import keycode from 'keycode'
import styles from './popover.css'

import KeyListener from '../keyboard/key-listener.jsx'
import Portal from './portal.jsx'

const ESCAPE = keycode('esc')
const OPEN_DELAY = 125
const OPEN_DURATION = 175
const CLOSE_DURATION = 100
const FAST_OUT_SLOW_IN = 'cubic-bezier(.4, 0, .2, 1)'

export default class Popover extends React.Component {
  static propTypes = {
    open: PropTypes.bool.isRequired,
    onDismiss: PropTypes.func.isRequired,
    children: PropTypes.func.isRequired,
  };

  state = {
    open: this.props.open,
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
  animationId = null;
  closeTimer = null;

  get opening() {
    return this.props.open
  }

  get closing() {
    return !this.props.open
  }

  onKeyDown = event => {
    if (event.keyCode !== ESCAPE) return false

    if (this.props.onDismiss && this.state.open && !this.closing) {
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
        this.animationId = window.requestAnimationFrame(this.animateOnOpen)
        this.setState({ open: true })
        clearTimeout(this.closeTimer)
        this.closeTimer = null
      } else {
        this.setState({
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
        this.closeTimer = setTimeout(() => this.setState({ open: false }), CLOSE_DURATION)
      }
    }
  }

  componentWillUnmount() {
    window.cancelAnimationFrame(this.animationId)
    clearTimeout(this.openTimer)
    clearTimeout(this.closeTimer)
  }

  render() {
    const { onDismiss, children } = this.props
    const { open } = this.state
    const opening = this.opening
    const closing = this.closing

    const renderChildren = () => {
      let state = null
      const timings = {
        openDelay: OPEN_DELAY,
        openDuration: OPEN_DURATION,
        closeDuration: CLOSE_DURATION,
      }
      if (open && opening && !closing) {
        state = 'opening'
      } else if (open && !opening && !closing) {
        state = 'opened'
      } else if (open && !opening && closing) {
        state = 'closing'
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
