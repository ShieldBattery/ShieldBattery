import path from 'path'
import mkdirp from 'mkdirp'

if (process.env.NODE_ENV === 'development') {
  require('source-map-support').install({ handleUncaughtExceptions: false })
}

if (process.env.ProgramData) {
  // We use our ProgramData folder for lots of stuff, so ensure its created before anything else
  // runs
  mkdirp.sync(path.join(process.env.ProgramData, 'shieldbattery'), 0o777)
}

import 'babel-polyfill'

// $ <executable> <script> <moduleName> ...
const modName = process.argv[2]
// requiring files explicitly so that webpack picks up on them easily
if (modName === 'shieldbattery') {
  require('./shieldbattery.js')
} else {
  require('./psi.js')
}
