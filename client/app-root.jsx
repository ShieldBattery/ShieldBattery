import React from 'react'
import { Link, RouteHandler } from 'react-router'
import auther from  './auth/auther.js'

import AppBar from './material/app-bar.jsx'
import { AppCanvas, LeftNav } from 'material-ui'

class AppRoot extends React.Component {
  render() {
    let overflowMenuItems = [
      { payload: 'logOut', text: 'Log out', action: () => this.onLogOutClicked() },
    ]

    return (
      <AppCanvas predefinedLayout={1}>
        <AppBar title='#teamliquid'/>
        <div className="mui-app-content-canvas">
          <RouteHandler />
        </div>
      </AppCanvas>
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
