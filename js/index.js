const path = require('path')

// $ <executable> <script> <moduleName> ...
const modName = process.argv[2]
const shieldbatteryDir = path.dirname(path.dirname(path.resolve(process.argv[1])))

// use two files for babel caching to avoid weirdness with two processes writing to the same file
process.env.BABEL_CACHE_PATH = path.join(shieldbatteryDir, `.${modName}.babel.json`)

require('babel-register')
require('babel-polyfill')

// requiring files explicitly so that browserify picks up on them easily
if (modName === 'shieldbattery') {
  require('./shieldbattery.js')
} else {
  require('./psi.js')
}
