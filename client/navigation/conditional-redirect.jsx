import React from 'react'
import { connect } from 'react-redux'

@connect(state => ({ auth: state.auth }))
class ConditionalRedirect extends React.Component {
  _ensureCondition(props) {
    if (!props.route.conditionFn(props.auth)) {
      props.dispatch(props.route.actionFn(props))
    }
  }

  componentWillMount() {
    this._ensureCondition(this.props)
  }

  componentWillReceiveProps(nextProps) {
    this._ensureCondition(nextProps)
  }

  render() {
    if (this.props.route.conditionFn(this.props.auth)) {
      const children = this.props.children
      return !Array.isArray(children) ? children : <div>children</div>
    } else {
      return <div></div>
    }
  }
}

export default ConditionalRedirect
