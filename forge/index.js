var forge = require('bindings')('forge')
  , fs = require('fs')

var vertShaderSrc = fs.readFileSync(require.resolve('./shaders/vert.glsl'))
  , fragShaderSrc = fs.readFileSync(require.resolve('./shaders/frag.glsl'))
forge.setVertexShader(vertShaderSrc)
forge.setFragmentShader(fragShaderSrc)

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
