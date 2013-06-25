/* jshint asi: true, laxcomma: true */

// To avoid needing to recompile all the time, we'd like to keep this JS very small and just make it
// run external JS. As such, we'll reproduce the behavior of the normal `node myfile.js` in here
// (which requires setting argv to simulate this).
var path = require('path')
  , Module = require('module')
  , proc_path = path.resolve(process.argv[0])
  , shieldbattery_path = path.dirname(proc_path)
  , module_name = path.basename(proc_path, path.extname(proc_path))
  , bootstrap_path =
      path.resolve(shieldbattery_path, path.join('.', 'js', module_name + '-entry.js'))

process.argv[1] = bootstrap_path
Module.runMain()
