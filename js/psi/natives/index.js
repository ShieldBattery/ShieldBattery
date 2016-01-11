const psi = process._linkedBinding('shieldbattery_psi')
const EventEmitter = require('events').EventEmitter

module.exports = new EventEmitter()

psi.registerShutdownHandler(function() {
  module.exports.emit('shutdown')
})

// cb is function(err, proc)
module.exports.launchProcess = function(params, cb) {
  const args = typeof params.args === 'string' ? params.args : (params.args || []).join(' ')
  psi.launchProcess(params.appPath, args, !!params.launchSuspended, params.currentDir || '',
      (err, proc) => {
        if (err) cb(err, proc)
        else cb(err, new Process(proc))
      })
}

module.exports.getInstallPathFromRegistry = function() {
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

let cachedRes = null
const RES_CACHE_TIME = 10000
module.exports.detectResolution = function(cb) {
  if (cachedRes) {
    return cb(null, cachedRes)
  }

  psi.detectResolution(function(err, res) {
    if (err) {
      return cb(err)
    }

    cachedRes = res
    setTimeout(function() {
      cachedRes = null
    }, RES_CACHE_TIME)

    cb(null, res)
  })
}

function Process(cProcess) {
  this.cProcess = cProcess
}

Process.prototype.injectDll = function(dllPath, injectFuncName) {
  return new Promise((resolve, reject) => {
    this.cProcess.injectDll(dllPath, injectFuncName, err => {
      if (err) reject(err)
      else resolve()
    })
  })
}

Process.prototype.resume = function() {
  return this.cProcess.resume()
}
