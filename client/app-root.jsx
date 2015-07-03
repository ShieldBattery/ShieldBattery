import React from 'react'
import { Link, RouteHandler } from 'react-router'
import auther from  './auth/auther.js'

import AppBar from './material/app-bar.jsx'
import LeftNav from './material/left-nav.jsx'

class AppRoot extends React.Component {
  render() {
    let overflowMenuItems = [
      { payload: 'logOut', text: 'Log out', action: () => this.onLogOutClicked() },
    ]

    return (
      <div className="flex-row">
        <LeftNav />
        <div className="flex-grow">
          <AppBar title='#teamliquid'/>
          <RouteHandler />
        </div>
      </div>
    )
  }

  onLogOutClicked() {
    auther.logOut()
  }
}

AppRoot.contextTypes = {
  muiTheme: React.PropTypes.object
}

export default AppRoot
