let React = require('react')
  , Router = require('react-router')
  , injectTapEventPlugin = require('react-tap-event-plugin')
  , routes = require('./routes.jsx')

if (!global._injectedTapEventPlugin) {
  injectTapEventPlugin()
  global._injectedTapEventPlugin = true
}

let createApp = () => {
  Router.run(routes, Router.HistoryLocation,
      Handler => React.render(<Handler />, document.getElementById('app')))
}

createApp()
