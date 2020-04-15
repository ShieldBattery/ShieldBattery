const os = require('os')
const { exec } = require('child_process')
const packageJson = require('../package.json')

const VERSION = packageJson.devDependencies.electron
const DIST_URL = 'https://electronjs.org/headers'

// Build the native modules for the current version of Electron (on Windows platform only).
// NOTE: This will only affect our own native modules (defined in `binding.gyp`); native
// modules included in `package.json` will be built based on their own settings.
if (os.platform() === 'win32') {
  exec(`node-gyp rebuild --target=${VERSION} --dist-url=${DIST_URL}`, (err, stdout, stderr) => {
    if (err) {
      // Msbuild outputs its errors to stdout, so output it as well.
      console.log('stdout:')
      console.log(stdout)
      console.log('Error installing the native dependencies: ' + err)
    }
  })
}
