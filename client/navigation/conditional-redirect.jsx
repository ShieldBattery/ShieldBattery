import React from 'react'

// Creates a component that conditionally redirects based on store data. createRedirectAction
// *must* result in this component being unmounted.
//
// shouldRedirect is function(currentState) => void
// createRedirectAction is function(currentState, router) => action
export default function createConditionalRedirect(name, shouldRedirect, createRedirectAction) {
  return class ConditionalRedirect extends React.Component {
    static displayName = name;
    static contextTypes = {
      router: React.PropTypes.object.isRequired,
      store: React.PropTypes.object.isRequired,
      redirectChecker: React.PropTypes.object.isRequired,
    };

    constructor(props, context) {
      super(props, context)
      this._unsubscriber = null
    }

    _subscribe() {
      if (!this._unsubscriber) {
        this._unsubscriber = this.context.redirectChecker.subscribe(() => this._handleChange())
      }
    }

    _unsubscribe() {
      if (this._unsubscriber) {
        this._unsubscriber()
        this._unsubscriber = null
      }
    }

    _handleChange() {
      const { router, store: { dispatch, getState } } = this.context
      if (shouldRedirect(getState())) {
        this._unsubscribe()
        dispatch(createRedirectAction(getState(), router))
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
      if (shouldRedirect(this.context.store.getState())) {
        return null
      }
      return React.Children.only(this.props.children)
    }
  }
}
