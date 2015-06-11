import React from 'react'
import Router from 'react-router'
import injectTapEventPlugin from 'react-tap-event-plugin'
import routes from './routes.jsx'

// initialize sockets
import siteSocket from './network/site-socket'
import psiSocket from './network/psi-socket'

let createApp = () => {
  Router.run(routes, Router.HistoryLocation,
      Handler => React.render(<Handler />, document.getElementById('app')))
}

if (!global._injectedTapEventPlugin) {
  injectTapEventPlugin()
  global._injectedTapEventPlugin = true

  createApp()
}
