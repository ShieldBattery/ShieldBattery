/* jshint asi: true, laxcomma: true */

// To avoid needing to recompile all the time, we'd like to keep this JS very small and just make it
// run external JS. As such, we'll reproduce the behavior of the normal `node myfile.js` in here
// (which requires setting argv to simulate this).
var path = require('path')
  , Module = require('module')
  , shieldbattery_path = path.dirname(path.resolve(process.argv[0]))
  , bootstrap_path = path.resolve(shieldbattery_path, './shieldbattery.js')
process.argv[1] = bootstrap_path
Module.runMain()
