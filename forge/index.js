var forge = require('bindings')('forge')

module.exports.inject = function() {
  return forge.inject()
}

module.exports.restore = function() {
  return forge.restore()
}
