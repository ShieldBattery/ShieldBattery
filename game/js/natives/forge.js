import { EventEmitter } from 'events'

import dxVertDepalettizing from './shaders/directx/vs_depalettizing.hlsl'
import dxPixelDepalettizing from './shaders/directx/ps_depalettizing.hlsl'
import dxPixelScaling from './shaders/directx/ps_scaling.hlsl'
import glVertDepalettizing from './shaders/opengl/vs_depalettizing.glsl'
import glVertScaling from './shaders/opengl/vs_scaling.glsl'
import glFragDepalettizing from './shaders/opengl/fs_depalettizing.glsl'
import glFragScaling from './shaders/opengl/fs_scaling.glsl'

const forge = process._linkedBinding('shieldbattery_forge').instance

const dxVertShaders = {
  depalettizing: dxVertDepalettizing,
}
const dxPixelShaders = {
  depalettizing: dxPixelDepalettizing,
  scaling: dxPixelScaling,
}
const glVertShaders = {
  depalettizing: glVertDepalettizing,
  scaling: glVertScaling,
}
const glFragShaders = {
  depalettizing: glFragDepalettizing,
  scaling: glFragScaling,
}

forge.setShaders(dxVertShaders, dxPixelShaders, glVertShaders, glFragShaders)

let wndProcRunning = false

class JsForge extends EventEmitter {
  constructor() {
    super()
    forge.onPublishEvent = ({ type, payload }) => {
      this.emit(type, payload)
    }
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
