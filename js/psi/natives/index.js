var psi = process._linkedBinding('shieldbattery_psi')
  , EventEmitter = require('events').EventEmitter

module.exports = new EventEmitter()

psi.registerShutdownHandler(function() {
  module.exports.emit('shutdown')
})

// cb is function(err, proc)
module.exports.launchProcess = function(params, cb) {
  console.log('launching process with params:')
  console.dir(params)
  var args = typeof params.args == 'string' ? params.args : (params.args || []).join(' ')
  psi.launchProcess(params.appPath, args, !!params.launchSuspended, params.currentDir || '',
    function(err, proc) {
      if (err) cb(err, proc)
      else cb(err, new Process(proc))
    })
}

module.exports.getInstallPathFromRegistry = function() {
  var regPath = 'SOFTWARE\\Blizzard Entertainment\\Starcraft'
    , regValueName = 'InstallPath'
    , result

  try {
    result = psi.registry.readString('hkcu', regPath, regValueName)
  } catch (err) {
  }
  if (result) return result
  try {
    result = psi.registry.readString('hklm', regPath, regValueName)
  } catch (err) {
  }

  return result
}

var cachedRes = null
  , RES_CACHE_TIME = 10000
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

// cb is function(err)
Process.prototype.injectDll = function(dllPath, injectFuncName, cb) {
  console.log('injecting ' + dllPath + ', then calling ' + injectFuncName)
  var boundCb = cb.bind(this)
  this.cProcess.injectDll(dllPath, injectFuncName, boundCb)
}

Process.prototype.resume = function() {
  return this.cProcess.resume()
}
