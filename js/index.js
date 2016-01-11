require('babel-register')
require('babel-polyfill')

const modName = process.argv[process.argv.length - 1]

// requiring files explicitly so that browserify picks up on them easily
if (modName === 'shieldbattery') {
  require('./shieldbattery.js')
} else {
  require('./psi.js')
}
