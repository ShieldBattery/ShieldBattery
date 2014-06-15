var psi = require('bindings')('psi')
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

module.exports.detectResolution = function() {
  return psi.detectResolution()
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
