import React from 'react'
import { connect } from 'react-redux'

import { Body1 } from '../styles/typography'

@connect(state => ({ activeUsers: state.serverStatus.get('activeUsers') }))
class ActiveUsersCount extends React.Component {
  render() {
    const {
      activeUsers,
      dispatch, // eslint-disable-line no-unused-vars
      ...otherProps
    } = this.props
    const activeUsersStr = activeUsers === null ? '' : `${activeUsers} online`
    return <Body1 {...otherProps}>{activeUsersStr}</Body1>
  }
}

export default ActiveUsersCount
