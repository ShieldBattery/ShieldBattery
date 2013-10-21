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

var forge = require('forge')
if (!forge.inject()) {
  throw new Error('forge injection failed')
} else {
  log.verbose('forge injected')
}

forge.on('startWndProc', function() {
  log.verbose('forge\'s wndproc pump started')
}).on('endWndProc', function() {
  log.verbose('forge\'s wndproc pump finished')
})

var io = require('socket.io-client')
  , host = require('./shieldbattery/host')
  , join = require('./shieldbattery/join')

bw.initProcess(function afterInit(err) {
  if (err) {
    throw err
  }

  log.verbose('process initialized')
  forge.runWndProc()

  connectToPsi()
})

function connectToPsi() {
  var socket = io.connect('https://lifeoflively.net:33198/game')

  socket.on('connect', function() {
    log.verbose('Connected to psi.')
  }).on('disconnect', function() {
    log.verbose('Disconnected from psi...')
  }).on('error', function(err) {
    log.error('Error connecting to psi, is it running? Error: ' + err)
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
}

