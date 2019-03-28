if (process.env.NODE_ENV === 'development') {
  require('source-map-support').install({ handleUncaughtExceptions: false })
}

import 'core-js/stable'
import 'regenerator-runtime/runtime'
import './app.js'
