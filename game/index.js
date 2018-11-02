if (process.env.NODE_ENV === 'development') {
  require('source-map-support').install({ handleUncaughtExceptions: false })
}

import '@babel/polyfill'
import './app.js'
