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
  if (running) return
  running = true

  bw.initProcess(function() {
    console.log('process initialized!')

    var gameSettings =
        { mapPath: 'C:\\Program Files (x86)\\StarCraft\\Maps\\BroodWar\\(2)Astral Balance.scm'
        , gameType: 0x10002 // melee
        }
    bw.createLobby('tec27', gameSettings, onCreateLobby)
  })

  var lobby

  function onError(err) {
    running = false
    console.log(err)
  }

  function onCreateLobby(err, newLobby) {
    if (err) return onError(err)
    lobby = newLobby
    lobby.addComputer(1, onComputerAdded)
  }

  function onComputerAdded(err) {
    if (err) return onError(err)
    lobby.startCountdown(onCountdownStarted)
  }

  function onCountdownStarted(err) {
    if (err) return onError(err)
    lobby.once('gameInit', function() {
      lobby.runGameLoop(onGameFinished)
      console.log('Game started!')
      running = true
    })
  }

  function onGameFinished(err) {
    running = false
    console.log('Game completed.')
  }
})

process.on('uncaughtException', function(err) {
  console.log(err.message)
  console.log(err.stack)
  setTimeout(function() { process.exit() }, 20000)
})
