let React = require('react')
  , { Link, RouteHandler } = require('react-router')
  , MoreVert = require('./material/icons/more-vert.jsx')
  , auther = require('./auth/auther.js')

let { AppCanvas, AppBar, LeftNav, DropDownIcon } = require('material-ui')

let App = React.createClass({
  render() {
    let overflowMenuItems = [
      { payload: 'logOut', text: 'Log out', action: () => this.onLogOutClicked() },
    ]

    return (
      <AppCanvas predefinedLayout={1}>
        <AppBar className='mui-dark-theme' zDepth={2} showMenuIconButton={false}
            title=<Link to='home'><h1 className='mui-app-bar-title'>ShieldBattery</h1></Link>>
          <DropDownIcon menuItems={overflowMenuItems}
              onChange={ (e, key, payload) => payload.action() }>
            <MoreVert />
          </DropDownIcon>
        </AppBar>

        <div className="mui-app-content-canvas">
          <RouteHandler />
        </div>
      </AppCanvas>
    )
  },

  onLogOutClicked() {
    auther.logOut()
  },
})

module.exports = App
