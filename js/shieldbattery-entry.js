var bw = require('bw')
  , io = require('socket.io-client')
  , path = require('path')
  , shieldbatteryRoot = path.dirname(path.resolve(process.argv[0]))

var socket = io.connect('http://localhost:33198/game')
  , running = false

socket.on('connect', function() {
  console.log('Connected to psi.')
  socket.emit('status', running ? 'running' : 'init')
}).on('disconnect', function() {
  console.log('Disconnected from psi...')
}).on('error', function(err) {
  console.log('Error connecting to psi, is it running? Error: ' + err)
}).on('load', function(plugins, cb) {
  var leftToLoad = plugins.length
    , errors = {}

  if (!plugins.length) done()

  plugins.forEach(function(plugin) {
    var absolute = path.resolve(shieldbatteryRoot, 'plugins', plugin)
    bw.loadPlugin(absolute, function(err) {
      if (err) errors[plugin] = err.message
      leftToLoad--
      if (!leftToLoad) done()
    })
  })

  function done() {
    cb(errors)
  }
}).on('start', function() {
  if (!running) {
    running = true
    bw.initProcess(function() {
      console.log('process initialized!')
      bw.createAndRunGame(function(err) {
        if (err) {
          running = false
          return console.log('Error creating/running game: ' + err)
        }

        console.log('game running!')
        running = true
      })
    })
  }
})

process.on('uncaughtException', function(err) {
  console.dir(err)
  setTimeout(function() { process.exit() }, 10000)
})
