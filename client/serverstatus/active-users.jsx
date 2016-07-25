import React from 'react'
import { connect } from 'react-redux'

@connect(state => ({ activeUsers: state.serverStatus.get('activeUsers') }))
class ActiveUsersCount extends React.Component {
  render() {
    const {
      activeUsers,
      dispatch, // eslint-disable-line no-unused-vars
      ...otherProps,
    } = this.props
    const pluralized = activeUsers !== 1 ? 'users' : 'user'
    const activeUsersStr = activeUsers === null ? '' : `${activeUsers} ${pluralized} online`
    return <p {...otherProps}>{activeUsersStr}</p>
  }
}

export default ActiveUsersCount
