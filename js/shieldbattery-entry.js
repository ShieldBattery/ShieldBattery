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

var io = require('socket.io-client')
  , path = require('path')
  , host = require('./shieldbattery/host')
  , join = require('./shieldbattery/join')
  , shieldbatteryRoot = path.dirname(path.resolve(process.argv[0]))

var socket = io.connect('https://lifeoflively.net:33198/game')

socket.on('connect', function() {
  log.verbose('Connected to psi.')
}).on('disconnect', function() {
  log.verbose('Disconnected from psi...')
}).on('error', function(err) {
  log.error('Error connecting to psi, is it running? Error: ' + err)
}).on('load', function(plugins, cb) {
  var leftToLoad = plugins.length
    , errors = {}

  if (!plugins.length) done()

  plugins.forEach(function(plugin) {
    var absolute = path.resolve(shieldbatteryRoot, 'plugins', plugin)
    bw.loadPlugin(absolute, function(err) {
      if (err) {
        errors[plugin] = err.message
        log.error('could not load ' + plugin + ': ' + err)
      }
      leftToLoad--
      if (!leftToLoad) done()
    })
  })

  function done() {
    cb(errors)
  }
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


