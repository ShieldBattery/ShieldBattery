import fs from 'fs'
import { EventEmitter } from 'events'

const forge = process._linkedBinding('shieldbattery_forge').instance

let dxVertShaders
let dxPixelShaders
let glVertShaders
let glFragShaders

if (WEBPACK_BUILD) { // eslint-disable-line no-undef
  dxVertShaders = {
    depalettizing: require('./shaders/directx/vs_depalettizing.hlsl'),
  }
  dxPixelShaders = {
    depalettizing: require('./shaders/directx/ps_depalettizing.hlsl'),
    scaling: require('./shaders/directx/ps_scaling.hlsl')
  }
  glVertShaders = {
    depalettizing: require('./shaders/opengl/vs_depalettizing.glsl'),
    scaling: require('./shaders/opengl/vs_scaling.glsl')
  }
  glFragShaders = {
    depalettizing: require('./shaders/opengl/fs_depalettizing.glsl'),
    scaling: require('./shaders/opengl/fs_scaling.glsl')
  }
} else {
  dxVertShaders = {
    depalettizing: fs.readFileSync(__dirname + '/shaders/directx/vs_depalettizing.hlsl'),
  }
  dxPixelShaders = {
    depalettizing: fs.readFileSync(__dirname + '/shaders/directx/ps_depalettizing.hlsl'),
    scaling: fs.readFileSync(__dirname + '/shaders/directx/ps_scaling.hlsl')
  }
  glVertShaders = {
    depalettizing: fs.readFileSync(__dirname + '/shaders/opengl/vs_depalettizing.glsl'),
    scaling: fs.readFileSync(__dirname + '/shaders/opengl/vs_scaling.glsl')
  }
  glFragShaders = {
    depalettizing: fs.readFileSync(__dirname + '/shaders/opengl/fs_depalettizing.glsl'),
    scaling: fs.readFileSync(__dirname + '/shaders/opengl/fs_scaling.glsl')
  }
}

forge.setShaders(dxVertShaders, dxPixelShaders, glVertShaders, glFragShaders)

let wndProcRunning = false

class JsForge extends EventEmitter {
  constructor() {
    super()
  }

  inject() {
    const success = forge.inject()
    if (success) this.emit('injected')
    return success
  }

  restore() {
    const success = forge.restore()
    if (success) this.emit('restored')
    return success
  }

  endWndProc() {
    if (wndProcRunning) {
      forge.endWndProc()
    }
  }

  runWndProc() {
    if (wndProcRunning) {
      return
    }

    forge.runWndProc((_err, quit) => {
      if (wndProcRunning) {
        wndProcRunning = false
        this.emit('endWndProc')
      }
    })
    wndProcRunning = true
    this.emit('startWndProc')
  }
}

export default new JsForge()
