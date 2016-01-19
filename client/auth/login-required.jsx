import React from 'react'
import { connect } from 'react-redux'
import { isLoggedIn } from './auth-utils'
import { routeActions } from 'redux-simple-router'

@connect(state => ({ auth: state.auth }))
class LoginRequired extends React.Component {
  _ensureAuthed(props) {
    if (!isLoggedIn(props.auth)) {
      const { location: loc } = this.props
      const query = {
        nextPath: props.history.createPath(loc.pathname, loc.query)
      }
      props.dispatch(routeActions.push({ pathname: '/login', query }))
    }
  }

  componentWillMount() {
    this._ensureAuthed(this.props)
  }

  componentWillReceiveProps(nextProps) {
    this._ensureAuthed(nextProps)
  }

  render() {
    if (isLoggedIn(this.props.auth)) {
      const children = this.props.children
      return !Array.isArray(children) ? children : <div>children</div>
    } else {
      return <div></div>
    }
  }
}

export default LoginRequired
