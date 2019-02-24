import React from 'react'
import PropTypes from 'prop-types'
import ReactDOM from 'react-dom'
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
    this.addPortal()
  }

  componentDidUpdate() {
    this.addPortal()
  }

  componentWillUnmount() {
    this.removePortal()
  }

  addPortal() {
    if (this.portal) return

    this.portal = document.createElement('div')
    this.portal.classList.add(styles.portal)
    document.body.appendChild(this.portal)
  }

  onClickAway = event => {
    if (!this.props.onDismiss || !this.props.open) return
    this.props.onDismiss()
  }

  removePortal() {
    if (!this.portal) return

    document.body.removeChild(this.portal)
    this.portal = null
  }

  render() {
    const { open, scrim, propagateClicks, children } = this.props
    const scrimStyle = { opacity: scrim ? 1 : 0 }
    if (propagateClicks) {
      scrimStyle.visibility = scrim ? 'visible' : 'hidden'
    }
    const contents = (
      <>
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
      </>
    )

    return this.portal ? ReactDOM.createPortal(contents, this.portal) : null
  }
}
