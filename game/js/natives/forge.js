import { EventEmitter } from 'events'

const forge = process._linkedBinding('shieldbattery_forge').instance

const dxVertShaders = {
  depalettizing: require('./shaders/directx/vs_depalettizing.hlsl'),
}
const dxPixelShaders = {
  depalettizing: require('./shaders/directx/ps_depalettizing.hlsl'),
  scaling: require('./shaders/directx/ps_scaling.hlsl')
}
const glVertShaders = {
  depalettizing: require('./shaders/opengl/vs_depalettizing.glsl'),
  scaling: require('./shaders/opengl/vs_scaling.glsl')
}
const glFragShaders = {
  depalettizing: require('./shaders/opengl/fs_depalettizing.glsl'),
  scaling: require('./shaders/opengl/fs_scaling.glsl')
}

forge.setShaders(dxVertShaders, dxPixelShaders, glVertShaders, glFragShaders)

let wndProcRunning = false

class JsForge extends EventEmitter {
  constructor() {
    super()
    forge.onPublishEvent = ({ type, payload }) => { this.emit(type, payload) }
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
