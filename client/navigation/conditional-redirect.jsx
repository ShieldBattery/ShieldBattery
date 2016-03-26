import React from 'react'

export default function redirectFn(conditionFn, actionFn) {
  return class ConditionalRedirect extends React.Component {
    static contextTypes = {
      store: React.PropTypes.object.isRequired,
    };

    constructor(props) {
      super(props)
      this._storeListener = null
    }

    _ensureCondition() {
      if (!conditionFn(this.context.store.getState().auth)) {
        this.context.store.dispatch(actionFn(this.props))
      }
    }

    componentWillMount() {
      this._ensureCondition()
    }

    componentDidMount() {
      this._storeListener = this.context.store.subscribe(() => this._ensureCondition())
    }

    componentWillReceiveProps() {
      this._ensureCondition()
    }

    componentWillUnmount() {
      this._storeListener()
    }

    render() {
      if (conditionFn(this.context.store.getState().auth)) {
        return React.Children.only(this.props.children)
      } else {
        return <div></div>
      }
    }
  }
}
