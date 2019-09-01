const os = require('os')
const { exec } = require('child_process')

// Build the native modules on Windows platform only
// NOTE: This will only affect our own native modules (defined in `binding.gyp`); native
// modules included in `package.json` will be built based on their own settings.
if (os.platform() === 'win32') {
  exec('node-gyp rebuild', (err, stdout, stderr) => {
    if (err) {
      // Msbuild outputs its errors to stdout, so output it as well.
      console.log('stdout:')
      console.log(stdout)
      console.log('Error installing the native dependencies: ' + err)
    }
  })
}
