var psi = require('bindings')('psi')

// cb is function(err, proc)
module.exports.launchProcess = function(params, cb) {
  console.log('launching process with params:')
  console.dir(params)
  var args = typeof params.args == 'string' ? params.args : (params.args || []).join(' ')
  psi.launchProcess(params.appPath, args, !!params.launchSuspended, params.currentDir || '', cb)
}
