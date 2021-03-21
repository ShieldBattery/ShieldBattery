import React from 'react'
import PropTypes from 'prop-types'
import ReactDOM from 'react-dom'
import { CSSTransition, TransitionGroup } from 'react-transition-group'
import styled from 'styled-components'
import { rgba } from 'polished'

import { zIndexDialogScrim } from './zindex'
import { dialogScrim } from '../styles/colors'

const transitionNames = {
  appear: 'enter',
  appearActive: 'enterActive',
  enter: 'enter',
  enterActive: 'enterActive',
  exit: 'exit',
  exitActive: 'exitActive',
}

const Scrim = styled.div`
  position: fixed;
  left: 0;
  top: var(--sb-system-bar-height, 0);
  right: 0;
  bottom: 0;

  background-color: ${rgba(dialogScrim, 0.42)};
  /*
    Even though we're using React's CSS Transition Group to animate the scrim with the classes below
    we also have a transition of "opacity" property here, because it is possible in some special
    case (Dialogs) for scrim to always be rendered.
  */
  transition: opacity 250ms linear;
  -webkit-app-region: no-drag;

  &.enter {
    background-color: ${rgba(dialogScrim, 0)};
  }

  &.enterActive {
    background-color: ${rgba(dialogScrim, 0.42)};
    transition: background-color 250ms linear;
  }

  &.exit {
  }

  &.exitActive {
    transition: background-color 200ms linear;
    background-color: ${rgba(dialogScrim, 0)};
  }
`

// A component for rendering component trees into 'portals', that is, roots that exist outside of
// the React root. This is useful for things like modal dialogs, popovers, etc. Contains
// functionality for being dismissed when a click-away occurs, and can optionally scrim the screen
// behind the portal content. If a scrim is displayed, clicks will not propagate to the elements
// behind it. If a scrim is not displayed though, the propagation of clicks to the elements behind
// it can be configured with `propagateClicks` props.
export default class Portal extends React.Component {
  static propTypes = {
    children: PropTypes.func.isRequired,
    open: PropTypes.bool.isRequired,
    onDismiss: PropTypes.func,
    scrim: PropTypes.bool,
    scrimZIndex: PropTypes.number,
    propagateClicks: PropTypes.bool,
  }

  portal = document.createElement('div')

  componentDidMount() {
    this.addPortal()
  }

  componentWillUnmount() {
    this.removePortal()
  }

  addPortal() {
    document.body.appendChild(this.portal)
  }

  onClickAway = event => {
    if (!this.props.onDismiss || !this.props.open) return
    this.props.onDismiss()
  }

  removePortal() {
    document.body.removeChild(this.portal)
  }

  render() {
    const { open, scrim, scrimZIndex, propagateClicks, children } = this.props
    const scrimStyle = { opacity: scrim ? 1 : 0, zIndex: scrimZIndex || zIndexDialogScrim }
    if (propagateClicks) {
      scrimStyle.visibility = scrim ? 'visible' : 'hidden'
    }
    const contents = (
      <>
        <TransitionGroup>
          {open ? (
            <CSSTransition
              classNames={transitionNames}
              appear={true}
              timeout={{ appear: 250, enter: 250, exit: 200 }}>
              <Scrim key={'scrim'} style={scrimStyle} onClick={this.onClickAway} />
            </CSSTransition>
          ) : null}
        </TransitionGroup>
        {open ? children() : null}
      </>
    )

    return ReactDOM.createPortal(contents, this.portal)
  }
}
