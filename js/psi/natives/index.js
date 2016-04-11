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

  try {
    const result = psi.registry.readString('hkcu', regPath, regValueName)
    if (result) {
      return result
    }
  } catch (err) {
    // Intentionally empty
  }

  try {
    const result = psi.registry.readString('hklm', regPath, regValueName)
    if (result) {
      return result
    }
  } catch (err) {
    // Intentionally empty
  }

  let recentMaps
  try {
    recentMaps = psi.registry.readMultiString('hkcu', regPath, 'Recent Maps')
  } catch (err) {
    // Intentionally empty
  }
  if (!recentMaps) {
    return undefined
  }

  // Filter out paths from 'Recent Maps' value saved in registry, until we get the one we can be
  // reasonably certain is a Starcraft install path. Assumption we make is that Starcraft's install
  // path must have the 'maps' folder.
  const paths = recentMaps.filter(p => {
    const path = p.toLowerCase()
    return path.includes('\\maps\\') && !path.includes('\\programdata\\shieldbattery')
  })
  if (!paths.length) {
    return undefined
  }

  // We make a reasonable guess that the remaining paths are all inside Starcraft folder. For now
  // we're not taking into account multiple different install paths, so just pick the first one.
  const path = paths[0]
  const mapsIndex = path.toLowerCase().lastIndexOf('\\maps\\')
  return path.slice(0, mapsIndex)
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
