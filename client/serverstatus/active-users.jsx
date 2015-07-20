import React from 'react'
import { connect } from 'react-redux'
import { register, unregister } from './server-status-checker'

@connect(state => ({ activeUsers: state.serverStatus.get('activeUsers') }))
class ActiveUsersCount extends React.Component {
  componentDidMount() {
    this.props.dispatch(register())
  }

  componentWillUnmount() {
    this.props.dispatch(unregister())
  }

  render() {
    const { activeUsers } = this.props
    const activeUsersStr = activeUsers === null ? 'unknown' : (activeUsers + '')
    return <p>Connected users: {activeUsersStr}</p>
  }
}

export default ActiveUsersCount
