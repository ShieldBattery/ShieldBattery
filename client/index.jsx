// TODO(tec27): it should be possibly to use the runtime option instead, but this was erroring
// out when I tried (Cannot find module 'babel-runtime/core-js'). Figure out why this error was
// happening and then go that route, rather than requiring the polyfill
require('babel/polyfill')

let React = require('react')
  , Router = require('react-router')
  , injectTapEventPlugin = require('react-tap-event-plugin')
  , routes = require('./routes.jsx')

injectTapEventPlugin()

Router.run(routes, Router.HistoryLocation,
    Handler => React.render(<Handler />, document.getElementById('app')))
