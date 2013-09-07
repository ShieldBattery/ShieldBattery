var bw = require('bw')
  , io = require('socket.io-client')
  , log = require('./shieldbattery/logger')
  , path = require('path')
  , shieldbatteryRoot = path.dirname(path.resolve(process.argv[0]))
  , host = require('./shieldbattery/host')
  , join = require('./shieldbattery/join')

var socket = io.connect('https://lifeoflively.net:33198/game')

bw.on('log', function(level, msg) {
  log.log(level, msg)
})

log.verbose('Shieldbattery running')

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
})

process.on('uncaughtException', function(err) {
  log.error(err.message)
  log.error(err.stack)
  process.exit()
})
