import React from 'react'
import PropTypes from 'prop-types'
import styled from 'styled-components'

import KeyListener from '../keyboard/key-listener.jsx'
import Portal from './portal.jsx'
import WindowListener from '../dom/window-listener.jsx'

import { fastOutSlowIn } from './curve-constants'
import { shadow6dp } from './shadows'
import { zIndexMenu, zIndexMenuBackdrop } from './zindex'
import { CardLayer } from '../styles/colors'

const ESCAPE = 'ESCAPE'

const OPEN_DELAY = 125
const OPEN_DURATION = 175
const CLOSE_DURATION = 100

const TIMINGS = {
  openDelay: OPEN_DELAY,
  openDuration: OPEN_DURATION,
  closeDuration: CLOSE_DURATION,
}

const Container = styled.div`
  background-color: transparent;
  position: fixed;
  z-index: ${zIndexMenu};
`

const ScaleHorizontal = styled.div`
  position: absolute;
  left: 0;
  top: 0;
  right: 0;
  bottom: 0;
`

const ScaleVertical = styled.div`
  width: 100%;
  height: 100%;
`

const Background = styled(CardLayer)`
  width: 100%;
  height: 100%;
  ${shadow6dp};
  border-radius: 2px;
`

export default class Popover extends React.Component {
  static propTypes = {
    open: PropTypes.bool.isRequired,
    onDismiss: PropTypes.func.isRequired,
    // A function that will be called to render children, parameters are:
    //   state: 'opening', 'opened', or 'closing'
    //   timings: { openDelay, openDuration, closeDuration } with timings for the various animations
    children: PropTypes.func.isRequired,
    // DOM element to position the Popover around
    anchor: PropTypes.object,
    // The vertical side of the `anchor` element that the Popover should animate out from
    // ('top' or 'bottom'). Defaults to top.
    anchorOriginVertical: PropTypes.oneOf(['top', 'bottom']),
    // The horizontal side of the `anchor` element that the Popover should animate out from
    // ('left' or 'right'). Defaults to left.
    anchorOriginHorizontal: PropTypes.oneOf(['left', 'right']),
    // An offset (in pixels) to adjust the anchorOrigin by (from the side specified by
    // `anchorOriginVertical`). Positive values move the anchorOrigin down, negative move it up.
    anchorOffsetVertical: PropTypes.number,
    // An offset (in pixels) to adjust the anchorOrigin by (from the side specified by
    // `anchorOriginHorizontal`). Positive values move the anchorOrigin right, negative move it
    // left.
    anchorOffsetHorizontal: PropTypes.number,
    // The vertical side of the Popover that should sit adjacent to the anchor element ('top' or
    // 'bottom'). Defaults to top.
    popoverOriginVertical: PropTypes.oneOf(['top', 'bottom']),
    // The horizontal side of the Popover that should sit adjacent to the anchor element ('left' or
    // 'right'). Defaults to left.
    popoverOriginHorizontal: PropTypes.oneOf(['left', 'right']),
    // Popover has a default transition that can be used to open/close its contents; if you wish to
    // use a different transition, you can disable the default one and implement your own.
    disableScaleTransition: PropTypes.bool,
  }

  static defaultProps = {
    anchorOriginVertical: 'top',
    anchorOriginHorizontal: 'left',
    anchorOffsetVertical: 0,
    anchorOffsetHorizontal: 0,
    popoverOriginVertical: 'top',
    popoverOriginHorizontal: 'left',
    disableScaleTransition: false,
  }

  state = {
    open: this.props.open,
    transitioning: false,
    popoverPosition: null,
    scaleHorizontalStyle: {
      transform: 'scaleX(0.3)',
      transformOrigin: `${this.props.popoverOriginHorizontal} ${this.props.popoverOriginVertical}`,
    },
    scaleVerticalStyle: {
      transform: 'scaleY(0.3)',
      transformOrigin: `${this.props.popoverOriginHorizontal} ${this.props.popoverOriginVertical}`,
    },
    backgroundStyle: {
      opacity: 0.1,
    },
  }
  animationId = null
  openTimer = null
  closeTimer = null

  get opening() {
    return this.state.transitioning && this.props.open
  }

  get closing() {
    return this.state.transitioning && !this.props.open
  }

  onKeyDown = event => {
    if (event.code !== ESCAPE) return false

    if (this.props.onDismiss && this.state.open && !this.closing) {
      this.props.onDismiss()
      return true
    }

    return false
  }

  animateOnOpen = props => {
    this.setState({
      scaleHorizontalStyle: {
        transform: 'scaleX(1)',
        transformOrigin: `${props.popoverOriginHorizontal} ${props.popoverOriginVertical}`,
        transition: `transform 200ms ${fastOutSlowIn}`,
      },
      scaleVerticalStyle: {
        transform: 'scaleY(1)',
        transformOrigin: `${props.popoverOriginHorizontal} ${props.popoverOriginVertical}`,
        transition: `transform 200ms ${fastOutSlowIn} 50ms`,
      },
      backgroundStyle: {
        opacity: 1,
        transition: `opacity 150ms ${fastOutSlowIn}`,
      },
    })
  }

  calculatePopoverPosition(props) {
    if (!props.anchor) {
      return null
    }

    const {
      anchor,
      anchorOffsetVertical,
      anchorOffsetHorizontal,
      anchorOriginVertical,
      anchorOriginHorizontal,
      popoverOriginVertical,
      popoverOriginHorizontal,
    } = props

    const clientWidth = document.body.clientWidth
    const clientHeight = document.body.clientHeight
    const anchorElement = anchor.getBoundingClientRect()
    const rect = {
      top: anchorElement.top + anchorOffsetVertical,
      right: anchorElement.right + anchorOffsetHorizontal,
      bottom: anchorElement.bottom + anchorOffsetVertical,
      left: anchorElement.left + anchorOffsetHorizontal,
      width: anchorElement.width,
      height: anchorElement.height,
    }

    const popoverPosition = {}
    if (popoverOriginVertical === 'top') {
      if (anchorOriginVertical === 'top') {
        popoverPosition.top = rect.top
      } else if (anchorOriginVertical === 'bottom') {
        popoverPosition.top = rect.top + rect.height
      }
    } else if (popoverOriginVertical === 'bottom') {
      if (anchorOriginVertical === 'top') {
        popoverPosition.bottom = clientHeight - rect.top
      } else if (anchorOriginVertical === 'bottom') {
        popoverPosition.bottom = clientHeight - (rect.top + rect.height)
      }
    }

    if (popoverOriginHorizontal === 'left') {
      if (anchorOriginHorizontal === 'left') {
        popoverPosition.left = rect.left
      } else if (anchorOriginHorizontal === 'right') {
        popoverPosition.left = rect.left + rect.width
      }
    } else if (popoverOriginHorizontal === 'right') {
      if (anchorOriginHorizontal === 'left') {
        popoverPosition.right = clientWidth - rect.left
      } else if (anchorOriginHorizontal === 'right') {
        popoverPosition.right = clientWidth - (rect.left + rect.width)
      }
    }

    return popoverPosition
  }

  componentWillReceiveProps(nextProps) {
    if (nextProps.open !== this.state.open) {
      const { popoverOriginHorizontal, popoverOriginVertical } = nextProps
      if (nextProps.open) {
        this.animationId = window.requestAnimationFrame(() => this.animateOnOpen(nextProps))
        this.setState({
          open: true,
          transitioning: true,
          popoverPosition: this.calculatePopoverPosition(nextProps),
        })
        clearTimeout(this.openTimer)
        this.openTimer = setTimeout(
          () => this.setState({ transitioning: false }),
          OPEN_DELAY + OPEN_DURATION,
        )
        clearTimeout(this.closeTimer)
        this.closeTimer = null
      } else {
        this.setState({
          transitioning: true,
          scaleHorizontalStyle: {
            transform: 'scaleX(0.3)',
            transformOrigin: `${popoverOriginHorizontal} ${popoverOriginVertical}`,
            transition: `transform 200ms ${fastOutSlowIn} 75ms`,
          },
          scaleVerticalStyle: {
            transform: 'scaleY(0.3)',
            transformOrigin: `${popoverOriginHorizontal} ${popoverOriginVertical}`,
            transition: `transform 200ms ${fastOutSlowIn} 25ms`,
          },
          backgroundStyle: {
            opacity: 0.1,
            transition: `opacity 175ms ${fastOutSlowIn} 100ms`,
          },
        })
        clearTimeout(this.closeTimer)
        this.closeTimer = setTimeout(
          () => this.setState({ open: false, transitioning: false }),
          CLOSE_DURATION,
        )
      }
    }
  }

  componentWillUnmount() {
    window.cancelAnimationFrame(this.animationId)
    clearTimeout(this.openTimer)
    clearTimeout(this.closeTimer)
  }

  render() {
    const { onDismiss, children, anchor, disableScaleTransition } = this.props
    const { open, popoverPosition: pos } = this.state

    if (!anchor) return null

    const renderContents = () => {
      if (!open && !this.closing) return null

      let state = 'opened'
      if (this.opening) {
        state = 'opening'
      } else if (this.closing) {
        state = 'closing'
      }

      const popoverStyle = {
        top: pos.top,
        bottom: pos.bottom,
        left: pos.left,
        right: pos.right,
      }

      return (
        <span>
          <WindowListener event='resize' listener={this.recalcPopoverPosition} />
          <WindowListener event='scroll' listener={this.recalcPopoverPosition} />
          <KeyListener onKeyDown={this.onKeyDown} exclusive={true} />
          {open ? (
            <Container key={'popover'} style={popoverStyle}>
              {disableScaleTransition ? null : (
                <ScaleHorizontal style={this.state.scaleHorizontalStyle}>
                  <ScaleVertical style={this.state.scaleVerticalStyle}>
                    <Background style={this.state.backgroundStyle} />
                  </ScaleVertical>
                </ScaleHorizontal>
              )}
              {children(state, TIMINGS)}
            </Container>
          ) : null}
        </span>
      )
    }

    return (
      <Portal onDismiss={onDismiss} open={open} scrimZIndex={zIndexMenuBackdrop}>
        {renderContents}
      </Portal>
    )
  }

  recalcPopoverPosition = () => {
    this.setState({
      popoverPosition: this.calculatePopoverPosition(this.props),
    })
  }
}
