import { EventEmitter } from 'events'
import thenify from 'thenify'
const psi = process._linkedBinding('shieldbattery_psi')

const emitter = new EventEmitter()
export default emitter

psi.registerShutdownHandler(function() {
  emitter.emit('shutdown')
})

class Process {
  constructor(cProcess) {
    this._cProcess = cProcess
  }

  async injectDll(dllPath, injectFuncName) {
    return new Promise((resolve, reject) => {
      this._cProcess.injectDll(dllPath, injectFuncName, err => {
        if (err) reject(err)
        else resolve()
      })
    })
  }

  resume() {
    const err = this._cProcess.resume()
    if (err) throw err
  }

  terminate() {
    const err = this._cProcess.terminate()
    if (err) throw err
  }

  async waitForExit() {
    return new Promise((resolve, reject) => {
      this._cProcess.waitForExit((err, code) => {
        if (err) {
          reject(err)
        } else {
          resolve(code)
        }
      })
    })
  }
}

const $launchProcess = thenify(psi.launchProcess)
async function launchProcess({ appPath, args = [], launchSuspended = true, currentDir = '' }) {
  const joinedArgs = typeof args === 'string' ? args : args.join(' ')
  const cProcess = await $launchProcess(appPath, joinedArgs, launchSuspended, currentDir)
  return new Process(cProcess)
}
export { launchProcess }

export function getInstallPathFromRegistry() {
  const regPath = 'SOFTWARE\\Blizzard Entertainment\\Starcraft'
  const regValueName = 'InstallPath'
  let result

  try {
    result = psi.registry.readString('hkcu', regPath, regValueName)
  } catch (err) {
    // Intentionally empty
  }
  if (result) return result
  try {
    result = psi.registry.readString('hklm', regPath, regValueName)
  } catch (err) {
    // Intentionally empty
  }

  return result
}

const $detectResolution = thenify(psi.detectResolution)
let cachedRes = null
const RES_CACHE_TIME = 10000
export async function detectResolution() {
  if (cachedRes) {
    return cachedRes
  }

  cachedRes = await $detectResolution()
  setTimeout(() => { cachedRes = null }, RES_CACHE_TIME)
  return cachedRes
}
