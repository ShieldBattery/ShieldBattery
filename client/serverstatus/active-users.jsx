import React from 'react'
import { connect } from 'react-redux'

import { Body1Old } from '../styles/typography'

@connect(state => ({ activeUsers: state.serverStatus.get('activeUsers') }))
class ActiveUsersCount extends React.Component {
  render() {
    const {
      activeUsers,
      dispatch, // eslint-disable-line @typescript-eslint/no-unused-vars
      ...otherProps
    } = this.props
    const activeUsersStr = activeUsers === null ? '' : `${activeUsers} online`
    return <Body1Old {...otherProps}>{activeUsersStr}</Body1Old>
  }
}

export default ActiveUsersCount
