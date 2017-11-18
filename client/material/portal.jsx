import React from 'react'
import PropTypes from 'prop-types'
import {
  unstable_renderSubtreeIntoContainer as renderSubtreeIntoContainer,
  unmountComponentAtNode,
} from 'react-dom'
import TransitionGroup from 'react-addons-css-transition-group'
import styles from './portal.css'

const transitionNames = {
  appear: styles.enter,
  appearActive: styles.enterActive,
  enter: styles.enter,
  enterActive: styles.enterActive,
  leave: styles.leave,
  leaveActive: styles.leaveActive,
}

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
    propagateClicks: PropTypes.bool,
  }

  portal = null

  componentDidMount() {
    this.renderPortal()
  }

  componentDidUpdate() {
    this.renderPortal()
  }

  componentWillUnmount() {
    this.removePortal()
  }

  renderPortal() {
    const { open, scrim, propagateClicks, children } = this.props

    if (!this.portal) {
      this.portal = document.createElement('div')
      this.portal.classList.add(styles.portal)
      document.body.appendChild(this.portal)
    }

    const scrimStyle = propagateClicks
      ? { visibility: scrim ? 'visible' : 'hidden' }
      : { opacity: scrim ? 1 : 0 }
    const contents = (
      <div>
        <TransitionGroup
          transitionName={transitionNames}
          transitionAppear={true}
          transitionAppearTimeout={250}
          transitionEnterTimeout={250}
          transitionLeaveTimeout={200}>
          {open ? (
            <div
              key={'scrim'}
              className={styles.scrim}
              style={scrimStyle}
              onClick={this.onClickAway}
            />
          ) : null}
        </TransitionGroup>
        {open ? children() : null}
      </div>
    )
    renderSubtreeIntoContainer(this, contents, this.portal)
  }

  onClickAway = event => {
    if (!this.props.onDismiss || !this.props.open) return
    this.props.onDismiss()
  }

  removePortal() {
    if (!this.portal) return

    unmountComponentAtNode(this.portal)
    document.body.removeChild(this.portal)
    this.portal = null
  }

  render() {
    return null
  }
}
