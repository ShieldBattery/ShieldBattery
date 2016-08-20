import React, { PropTypes } from 'react'
import {
  unstable_renderSubtreeIntoContainer as renderSubtreeIntoContainer,
  unmountComponentAtNode
} from 'react-dom'
import styles from './portal.css'

// A component for rendering component trees into 'portals', that is, roots that exist outside of
// the React root. This is useful for things like modal dialogs, popovers, etc. Contains
// functionality for being dismissed when a click-away occurs, and can optionally scrim the screen
// behind the portal content. If a scrim is displayed, clicks will not propagate to the elements
// behind it.
export default class Portal extends React.Component {
  static propTypes = {
    open: PropTypes.bool.isRequired,
    onDismiss: PropTypes.func,
    scrim: PropTypes.bool,
  };

  portal = null;
  _registeredSelfClick = false;
  _registeredWindowClick = false;

  componentDidMount() {
    this.renderPortal()
  }

  componentDidUpdate() {
    this.renderPortal()
  }

  componentWillUnmount() {
    this.removePortal()
  }

  onClickAway = event => {
    if (!this.props.onDismiss || !this.props.open) return

    const elem = this.portal
    if (event.currentTarget === window || event.target === elem ||
        (document.documentElement.contains(event.target) && !elem.contains(elem))) {
      this.props.onDismiss()
    }
  };

  registerSelfClick() {
    if (this._registeredSelfClick) return

    this.portal.addEventListener('click', this.onClickAway)
    this._registeredSelfClick = true
  }

  unregisterSelfClick() {
    if (!this._registeredSelfClick) return

    this.portal.removeEventListener('click', this.onClickAway)
    this._registeredSelfClick = false
  }

  registerWindowClick() {
    if (this._registeredWindowClick) return

    // Ensure that if this component was added because of a click, it doesn't receive that event
    // itself
    setTimeout(() => {
      window.addEventListener('click', this.onClickAway)
      this._registeredWindowClick = true
    }, 0)
  }

  unregisterWindowClick() {
    if (!this._registeredWindowClick) return

    window.removeEventListener('click', this.onClickAway)
    this._registeredWindowClick = false
  }

  renderPortal() {
    const { open, scrim, children } = this.props

    // TODO(tec27): animate scrim?
    if (open) {
      if (!this.portal) {
        this.portal = document.createElement('div')
        this.portal.classList.add(styles.portal)
        document.body.appendChild(this.portal)
      }
      if (scrim) {
        this.unregisterWindowClick()
        this.registerSelfClick()
        this.portal.classList.add(styles.scrim)
      } else {
        this.unregisterSelfClick()
        this.registerWindowClick()
        this.portal.classList.remove(styles.scrim)
      }

      renderSubtreeIntoContainer(this, React.Children.only(children), this.portal)
    } else {
      this.removePortal()
    }
  }

  removePortal() {
    if (!this.portal) return

    this.unregisterSelfClick()
    this.unregisterWindowClick()
    unmountComponentAtNode(this.portal)
    document.body.removeChild(this.portal)
    this.portal = null
  }

  render() {
    return null
  }
}
