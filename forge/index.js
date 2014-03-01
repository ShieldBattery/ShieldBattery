var forge = require('bindings')('forge')
  , fs = require('fs')
  , EventEmitter = require('events').EventEmitter
  , util = require('util')

var vertShaderSrc = fs.readFileSync(require.resolve('./shaders/vert.glsl'))
  , fragShaderSrc = fs.readFileSync(require.resolve('./shaders/frag.glsl'))
  , fboVertShaderSrc = fs.readFileSync(require.resolve('./shaders/fbo_vert.glsl'))
  , fboFragShaderSrc = fs.readFileSync(require.resolve('./shaders/fbo_frag.glsl'))
forge.setShaders(vertShaderSrc, fragShaderSrc, 'main')
forge.setShaders(fboVertShaderSrc, fboFragShaderSrc, 'fbo')

var wndProcRunning = false

function JsForge() {
  EventEmitter.call(this)
}
util.inherits(JsForge, EventEmitter)

JsForge.prototype.inject = function() {
  var success = forge.inject()
  if (success) this.emit('injected')
  return success
}

JsForge.prototype.restore = function() {
  var success = forge.restore()
  if (success) this.emit('restored')
  return success
}

JsForge.prototype.endWndProc = function() {
  if (wndProcRunning) {
    forge.endWndProc()
    wndProcRunning = false
    this.emit('endWndProc')
  }
}

JsForge.prototype.runWndProc = function() {
  if (wndProcRunning) {
    return
  }

  var self = this
  forge.runWndProc(function(err, quit) {
    if (wndProcRunning) {
      wndProcRunning = false
      self.emit('endWndProc')
    }
  })
  wndProcRunning = true
  this.emit('startWndProc')
}

module.exports = new JsForge()
