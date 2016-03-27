import React from 'react'

// Creates a component that conditionally redirects based on store data. createRedirectAction
// *must* result in this component being unmounted.
//
// shouldRedirect is function(currentState) => void
// createRedirectAction is function(currentState, history) => action
export default function createConditionalRedirect(name, shouldRedirect, createRedirectAction) {
  return class ConditionalRedirect extends React.Component {
    static displayName = name;
    static contextTypes = {
      store: React.PropTypes.object.isRequired,
    };

    constructor(props) {
      super(props)
      this._unsubscriber = null
    }

    _subscribe() {
      if (!this._unsubscriber) {
        this._unsubscriber = this.context.store.subscribe(() => this._handleChange())
      }
    }

    _unsubscribe() {
      if (this._unsubscriber) {
        this._unsubscriber()
        this._unsubscriber = null
      }
    }

    _handleChange() {
      const { store: { dispatch, getState } } = this.context
      if (shouldRedirect(getState())) {
        this._unsubscribe()
        dispatch(createRedirectAction(getState(), this.props.history))
      }
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
