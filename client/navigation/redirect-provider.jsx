import React from 'react'
import PropTypes from 'prop-types'

class RedirectChecker {
  constructor() {
    this._subs = []
  }

  subscribe(fn) {
    this._subs.push(fn)
    let subscribed = true
    return () => {
      if (!subscribed) return
      subscribed = false
      const index = this._subs.indexOf(fn)
      if (index === -1) return

      // If a component redirects, all of the components below it will be unmounted afterward, so
      // we pre-emptively remove all of them to avoid multiple redirects happening from the same
      // change
      this._subs.splice(this._subs.indexOf(fn))
    }
  }

  checkForRedirects() {
    for (const sub of this._subs) {
      if (sub()) {
        break
      }
    }
  }
}

// A component that should be placed near the root of the application, which provides redirect
// checking capabilities to all ConditionalRedirects. This is necessary because only one redirect
// should fire per store change.
export default class RedirectProvider extends React.Component {
  static childContextTypes = {
    redirectChecker: PropTypes.object.isRequired,
  }
  static contextTypes = {
    store: PropTypes.object.isRequired,
  }

  constructor(props, context) {
    super(props, context)
    this.redirectChecker = new RedirectChecker()
    this.unsubscriber = null
  }

  getChildContext() {
    return { redirectChecker: this.redirectChecker }
  }

  handleChange() {
    this.redirectChecker.checkForRedirects()
  }

  componentDidMount() {
    this.unsubscriber = this.context.store.subscribe(() => this.handleChange())
  }

  componentWillUnmount() {
    this.unsubscriber()
  }

  render() {
    return React.Children.only(this.props.children)
  }
}
