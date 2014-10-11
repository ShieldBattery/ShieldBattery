var fs = require('fs') // done separately so that brfs actually works, ugh

var forge = require('bindings')('forge')
  , EventEmitter = require('events').EventEmitter
  , util = require('util')

var dxVertShaders = { depalettizing: fs.readFileSync(__dirname + '/shaders/directx/vs_depalettizing.hlsl') }
  , dxPixelShaders = { depalettizing: fs.readFileSync(__dirname + '/shaders/directx/ps_depalettizing.hlsl')
                     , scaling: fs.readFileSync(__dirname + '/shaders/directx/ps_scaling.hlsl')
                     }
  , glVertShaders = { depalettizing: fs.readFileSync(__dirname + '/shaders/opengl/vs_depalettizing.glsl')
                    , scaling: fs.readFileSync(__dirname + '/shaders/opengl/vs_scaling.glsl')
                    }
  , glFragShaders = { depalettizing: fs.readFileSync(__dirname + '/shaders/opengl/fs_depalettizing.glsl')
                    , scaling: fs.readFileSync(__dirname + '/shaders/opengl/fs_scaling.glsl')
                    }

forge.setShaders(dxVertShaders, dxPixelShaders, glVertShaders, glFragShaders)

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
