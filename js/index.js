const path = require('path')
const mkdirp = require('mkdirp')

if (process.env.ProgramData) {
  // We use our ProgramData folder for lots of stuff, so ensure its created before anything else
  // runs
  mkdirp.sync(path.join(process.env.ProgramData, 'shieldbattery'), 0x0777)
}

// $ <executable> <script> <moduleName> ...
const modName = process.argv[2]
const cachePath = process.env.ProgramData ?
    path.join(process.env.ProgramData, 'shieldbattery') :
    path.dirname(path.dirname(path.resolve(process.argv[1])))

// use two files for babel caching to avoid weirdness with two processes writing to the same file
process.env.BABEL_CACHE_PATH = path.join(cachePath, `.${modName}.babel.json`)

require('babel-register')
require('babel-polyfill')

// requiring files explicitly so that browserify picks up on them easily
if (modName === 'shieldbattery') {
  require('./shieldbattery.js')
} else {
  require('./psi.js')
}
