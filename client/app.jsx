let React = require('react')
  , { Link, RouteHandler } = require('react-router')

let { AppCanvas, AppBar, LeftNav } = require('material-ui')

let App = React.createClass({
  render() {
    return (
      <AppCanvas predefinedLayout={1}>
        <AppBar className='mui-dark-theme' zDepth={0}
            title=<Link to="home"><h1 className="mui-app-bar-title">ShieldBattery</h1></Link>
            onMenuIconButtonTouchTap={this.onMenuIconButtonTouchTap}>
        </AppBar>

        <LeftNav ref="leftNav" menuItems={[]} docked={false} />

        <div className="mui-app-content-canvas">
          <RouteHandler />
        </div>
      </AppCanvas>
    )
  },

  onMenuIconButtonTouchTap() {
    this.refs.leftNav.toggle()
  },
})

module.exports = App
