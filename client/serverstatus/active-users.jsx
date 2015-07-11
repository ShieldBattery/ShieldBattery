import React from 'react'
import serverStatusChecker from './server-status-checker'
import activeUsersStore from './active-users-store'

class ActiveUsersCount extends React.Component {
  constructor() {
    super()
    this.activeUsersStoreListener = () => this.onActiveUsersChange()
    this.state = {
      activeUsers: activeUsersStore.activeUsers
    }
  }

  componentDidMount() {
    serverStatusChecker.registerInterest()
    activeUsersStore.register(this.activeUsersStoreListener)
  }

  componentWillUnmount() {
    activeUsersStore.unregister(this.activeUsersStoreListener)
    serverStatusChecker.unregisterInterest()
  }

  onActiveUsersChange() {
    this.setState({
      activeUsers: activeUsersStore.activeUsers
    })
  }

  render() {
    const activeUsersStr = this.state.activeUsers === null ?
        'unknown' : (this.state.activeUsers + '')
    return <p>Connected users: {activeUsersStr}</p>
  }
}

export default ActiveUsersCount
