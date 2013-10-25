// Put log and bw first to ensure we can log as much as possible in the event of a crash
var log = require('./shieldbattery/logger')
process.on('uncaughtException', function(err) {
  log.error(err.stack)
  // give the log time to write out
  setTimeout(function() {
    process.exit()
  }, 100)
})

var bw = require('bw')
bw.on('log', function(level, msg) {
  log.log(level, msg)
})

var io = require('socket.io-client')
  , host = require('./shieldbattery/host')
  , join = require('./shieldbattery/join')
  , socket = io.connect('https://lifeoflively.net:33198/game')
  , initialized = false

socket.on('connect', function() {
  log.verbose('Connected to psi.')
}).on('disconnect', function() {
  log.verbose('Disconnected from psi...')
}).on('error', function(err) {
  log.error('Error connecting to psi, is it running? Error: ' + err)
  setTimeout(function() {
    process.exit()
  }, 100)
}).on('setSettings', function(settings, cb) {
  log.verbose('received settings, initializing')
  log.verbose('settings: ' + JSON.stringify(settings, null, 2))
  initialize(settings, function(err) {
    if (err) {
      cb({ msg: err.message })
    } else {
      cb(null)
    }
  })
}).on('hostMode', function() {
  log.verbose('enabling host mode')
  host(socket)
}).on('joinMode', function() {
  log.verbose('enabling join mode')
  join(socket)
}).on('quit', function() {
  setTimeout(function() {
    process.exit()
  }, 100)
})

function initialize(settings, cb) {
  initialized = true
  bw.setSettings(settings)

  var forge = require('forge')
  if (!forge.inject()) {
    cb(new Error('forge injection failed'))
  } else {
    log.verbose('forge injected')
  }

  forge.on('startWndProc', function() {
    log.verbose('forge\'s wndproc pump started')
  }).on('endWndProc', function() {
    log.verbose('forge\'s wndproc pump finished')
  })

  bw.initProcess(function afterInit(err) {
    if (err) {
      return cb(err)
    }

    log.verbose('process initialized')
    forge.runWndProc()

    cb()
  })
}

