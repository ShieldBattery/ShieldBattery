import React from 'react'
import { Link, RouteHandler } from 'react-router'
import MoreVert from './material/icons/more-vert.jsx'
import auther from  './auth/auther.js'

import { AppCanvas, AppBar, LeftNav, DropDownIcon } from 'material-ui'

class AppRoot extends React.Component {
  render() {
    let overflowMenuItems = [
      { payload: 'logOut', text: 'Log out', action: () => this.onLogOutClicked() },
    ]

    let appBarTheme = this.context.muiTheme.component.appBar
    let titleStyle = {
      textDecoration: 'inherit',
      float: 'left',
      margin: 0,
      paddingTop: 0,
      letterSpacing: 0,
      fontSize: 24,
      fontWeight: 400,
      color: appBarTheme.textColor,
      lineHeight: appBarTheme.height + 'px',
    }
    let menuBtnStyle = {
      position: 'relative',
      padding: 12,
      width: 48,
      height: 48,
      float: 'right',
      marginLeft: 8,
      marginRight: -16,
      marginTop: 8,
    }

    return (
      <AppCanvas predefinedLayout={1}>
        <AppBar zDepth={2} showMenuIconButton={false}
            title=<Link to='home' style={titleStyle}>ShieldBattery</Link>>
          <DropDownIcon style={menuBtnStyle} menuItems={overflowMenuItems}
              onChange={ (e, key, payload) => payload.action() }>
            <MoreVert />
          </DropDownIcon>
        </AppBar>

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
