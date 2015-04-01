// TODO(tec27): it should be possible to use the runtime option instead, but this was erroring
// out when I tried (Cannot find module 'babel-runtime/core-js'). Figure out why this error was
// happening and then go that route, rather than requiring the polyfill
if (!global._babelPolyfill) {
  require('babel/polyfill')
}

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
