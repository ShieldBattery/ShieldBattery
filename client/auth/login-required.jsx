import React from 'react'
import { connect } from 'react-redux'
import { stringify } from 'query-string'
import { isLoggedIn } from './auth-utils'
import { pushPath } from 'redux-simple-router'

@connect(state => ({ auth: state.auth }))
class LoginRequired extends React.Component {
  _ensureAuthed(props) {
    if (!isLoggedIn(props.auth)) {
      const { location: loc } = this.props
      const query = stringify({
        nextPath: props.history.createPath(loc.pathname, loc.query)
      })
      props.dispatch(pushPath('/login?' + query, null))
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
