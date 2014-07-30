var modName = process.argv[2]
// requiring files explicitly so that browserify picks up on them easily
if (modName == 'shieldbattery') {
  require('./shieldbattery.js')
} else {
  require('./psi.js')
}
