import React from 'react'
import { connect } from 'react-redux'
import { isLoggedIn } from './auth-utils'
import { pushState } from 'redux-router'

@connect(state => ({ auth: state.auth, router: state.router }))
class LoginRequired extends React.Component {
  _ensureAuthed(props) {
    if (!isLoggedIn(props.auth)) {
      const { location: loc } = props.router
      props.dispatch(pushState(null, '/login', {
        nextPath: props.history.createPath(loc.pathname, loc.query),
      }))
    }
  }

  componentWillMount() {
    this._ensureAuthed(this.props)
  }

  componentWillReceiveProps(nextProps) {
    this._ensureAuthed(nextProps)
  }

  render() {
    const children = this.props.children
    return !Array.isArray(children) ? children : <div>children</div>
  }
}

export default LoginRequired
