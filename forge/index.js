var forge = require('bindings')('forge')

module.exports.inject = function() {
  return forge.inject()
}

module.exports.restore = function() {
  return forge.restore()
}

function endWndProc() {
  return forge.endWndProc()
}

module.exports.runWndProc = function(cb) {
  forge.runWndProc(cb)
  return endWndProc
}
