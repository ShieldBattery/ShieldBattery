// To avoid needing to recompile all the time, we'd like to keep this JS very small and just make it
// run external JS. As such, we'll reproduce the behavior of the normal `node myfile.js` in here
// (which requires setting argv to simulate this).
var path = require('path')
  , Module = require('module')
  , procPath = path.resolve(process.argv[0])
  , shieldbatteryPath = path.dirname(procPath)
  , moduleName = path.basename(procPath, path.extname(procPath))
  , bootstrapPath =
      path.resolve(shieldbatteryPath, path.join('.', 'js', 'index.js'))

process.argv[1] = bootstrapPath
process.argv[2] = moduleName
Module.runMain()
