import React from 'react'
import { connect } from 'react-redux'

@connect(state => ({ activeUsers: state.serverStatus.get('activeUsers') }))
class ActiveUsersCount extends React.Component {
  render() {
    const { activeUsers } = this.props
    const activeUsersStr = activeUsers === null ? 'unknown' : (activeUsers + '')
    return <p>Connected users: {activeUsersStr}</p>
  }
}

export default ActiveUsersCount
