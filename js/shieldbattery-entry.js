var bw = require('bw')
  , io = require('socket.io-client')
  , log = require('./shieldbattery/logger')
  , path = require('path')
  , shieldbatteryRoot = path.dirname(path.resolve(process.argv[0]))

var socket = io.connect('http://localhost:33198/game')
  , running = false

bw.on('log', function(level, msg) {
  log.log(level, msg)
})

socket.on('connect', function() {
  log.verbose('Connected to psi.')
  socket.emit('status', running ? 'running' : 'init')
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
      if (err) errors[plugin] = err.message
      leftToLoad--
      if (!leftToLoad) done()
    })
  })

  function done() {
    cb(errors)
  }
}).on('start', function(params) {
  if (running) return
  running = true

  bw.initProcess(function() {
    log.verbose('process initialized!')

// TODO(tec27): make a constants file, but: Possible values for Game Type (Sub Game Type):
// 0x02: Melee 0x03: Free for All 0x04: 1 vs 1 0x05: Capture The Flag
// 0x06: Greed (Resources, 0x01: 2500, 0x02: 500, 0x03: 7500, 0x04: 10000)
// 0x07: Slaughter (Minutes, 0x01: 15, 0x02: 30, 0x03: 45, 0x04: 60) 0x08: Sudden Death
// 0x09: Ladder (Disconnects, 0x00: Not a loss, 0x01: Counts as a loss) 0x0A: Use Map Settings
// 0x0B: Team Melee (Number Of Teams, 0x01: 2 Teams, 0x02: 3 Teams, etc.)
// 0x0C: Team Free For All (Number Of Teams, 0x01: 2 Teams, 0x02: 3 Teams, etc.)
// 0x0D: Team Capture The Flag (Number Of Teams, 0x01: 2 Teams, 0x02: 3 Teams, etc.)
// 0x0F: Top vs. Bottom (Number Of Teams, 1-7 specifies the ratio of players belonging to both teams
// 0x20: PGL
// any mode without a sub game type is just always 0x01 for that

    var gameSettings =
        { mapPath: params.map
        , gameType: 0x00010002 // melee
        }
    bw.createLobby(params.username, gameSettings, onCreateLobby)
  })

  var lobby

  function onError(err) {
    running = false
    log.error(err)
  }

  function onCreateLobby(err, newLobby) {
    if (err) return onError(err)
    lobby = newLobby
    lobby.setRace('terran', function(err) {
      if (err) return onError(err)
    })
    lobby.on('downloadStatus', onDownloadStatus)
  }

  function onDownloadStatus(slot, percent) {
    if (slot !== 0 && percent == 100) {
      setTimeout(function() {
        lobby.startCountdown(onCountdownStarted)
      }, 2000)
    }
  }

  function onCountdownStarted(err) {
    if (err) return onError(err)
    lobby.once('gameInit', function() {
      lobby.runGameLoop(onGameFinished)
      log.verbose('Game started!')
      running = true
    })
  }

  function onGameFinished(err) {
    running = false
    log.verbose('Game completed.')
    process.exit()
  }
}).on('join', function(params) {
  if (running) return
  running = true

  bw.initProcess(function() {
    log.verbose('process initialized!')

    bw.joinLobby(params.username, params.address, params.port, onJoinLobby)
  })

  var lobby

  function onError(err) {
    running = false
    log.error(err)
  }

  function onJoinLobby(err, newLobby) {
    if (err) return onError(err)
    lobby = newLobby;
    lobby.setRace('protoss', function(err) {
      if (err) log.error(err)
    })
    lobby.once('gameInit', function() {
      lobby.runGameLoop(onGameFinished)
      log.verbose('Game started!')
      running = true
    })
  }

  function onGameFinished(err) {
    running = false
    log.verbose('Game completed.')
    process.exit()
  }
})

process.on('uncaughtException', function(err) {
  log.error(err.message)
  log.error(err.stack)
  process.exit()
})
