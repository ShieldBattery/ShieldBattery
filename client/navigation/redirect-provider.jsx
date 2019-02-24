import React from 'react'
import { ReactReduxContext } from 'react-redux'

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

export const RedirectCheckerContext = React.createContext()

// A component that should be placed near the root of the application, which provides redirect
// checking capabilities to all ConditionalRedirects. This is necessary because only one redirect
// should fire per store change.
export default class RedirectProvider extends React.Component {
  static contextType = ReactReduxContext

  constructor(props) {
    super(props)
    this.unsubscriber = null
  }

  state = {
    value: { redirectChecker: new RedirectChecker() },
  }

  handleChange() {
    this.state.value.redirectChecker.checkForRedirects()
  }

  componentDidMount() {
    this.unsubscriber = this.context.store.subscribe(() => this.handleChange())
  }

  componentWillUnmount() {
    this.unsubscriber()
  }

  render() {
    return (
      <RedirectCheckerContext.Provider value={this.state.value}>
        {React.Children.only(this.props.children)}
      </RedirectCheckerContext.Provider>
    )
  }
}
