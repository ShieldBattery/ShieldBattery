import React from 'react'
import { connect } from 'react-redux'

@connect(state => ({ activeUsers: state.serverStatus.get('activeUsers') }))
class ActiveUsersCount extends React.Component {
  render() {
    const { activeUsers } = this.props
    const pluralized = activeUsers !== 1 ? 'users' : 'user'
    const activeUsersStr = activeUsers === null ? '' : `${activeUsers} ${pluralized} online`
    return <p {...this.props}>{activeUsersStr}</p>
  }
}

export default ActiveUsersCount
