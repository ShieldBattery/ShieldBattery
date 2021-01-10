import React from 'react'
import { ReactReduxContext } from 'react-redux'
import { RedirectCheckerContext } from './redirect-provider'

// Creates a component that conditionally redirects based on store data. createRedirectAction
// *must* result in this component being unmounted.
//
// shouldRedirect is function(currentState) => void
// createRedirectAction is function(currentState) => action
export default function createConditionalRedirect(name, shouldRedirect, createRedirectAction) {
  class ConditionalRedirect extends React.Component {
    static displayName = name

    constructor(props) {
      super(props)
      this._unsubscriber = null
    }

    _subscribe() {
      if (!this._unsubscriber) {
        this._unsubscriber = this.props.redirectChecker.subscribe(() => this._handleChange())
      }
    }

    _unsubscribe() {
      if (this._unsubscriber) {
        this._unsubscriber()
        this._unsubscriber = null
      }
    }

    _handleChange() {
      const {
        store: { dispatch, getState },
      } = this.props
      if (shouldRedirect(getState())) {
        this._unsubscribe()
        dispatch(createRedirectAction(getState()))
        return true
      }
      return false
    }

    componentDidMount() {
      this._subscribe()
      this._handleChange()
    }

    componentWillUnmount() {
      this._unsubscribe()
    }

    render() {
      if (shouldRedirect(this.props.store.getState())) {
        return null
      }
      return React.Children.only(this.props.children)
    }
  }

  return props => (
    <ReactReduxContext.Consumer>
      {({ store }) => (
        <RedirectCheckerContext.Consumer>
          {({ redirectChecker }) => (
            <ConditionalRedirect store={store} redirectChecker={redirectChecker}>
              {React.Children.only(props.children)}
            </ConditionalRedirect>
          )}
        </RedirectCheckerContext.Consumer>
      )}
    </ReactReduxContext.Consumer>
  )
}
