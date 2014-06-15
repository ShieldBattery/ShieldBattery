var log = require('./psi/logger')
process.on('uncaughtException', function(err) {
  log.error(err.stack)
  // give the log time to write out
  setTimeout(function() {
    process.exit()
  }, 100)
})

var psi = require('psi')
  , path = require('path')
  , httpServer = require('./psi/http-server')(33198, '127.0.0.1')
  , io = require('socket.io').listen(httpServer)
  , shieldbatteryRoot = path.dirname(process.execPath)
  , localSettings = require('./psi/local-settings')(path.join(shieldbatteryRoot, 'settings.json'))

io.configure(function() {
  io.set('transports', ['websocket'])
    .set('log level', 2)
})

var siteSockets = io.of('/site')
  , gameSocket

// directly pass a command from the siteSocket to the gameSocket (and pass the response back)
function passThrough(gameCommand) {
  return function() {
    var args = Array.prototype.slice.call(arguments, 0)
    if (args.length > 0 && typeof args[args.length - 1] == 'function') {
      if (!gameSocket) {
        return args[args.length - 1]({ msg: 'Not connected to game' })
      }

      var cb = args[args.length - 1]
      args[args.length - 1] = function(dummyParam) {
        cb.apply(this, arguments)
      }
    }

    if (!gameSocket) return
    args.unshift(gameCommand)
    gameSocket.emit.apply(gameSocket, args)
  }
}

// directly pass an event from the gameSocket back to the siteSocket
function passBack(gameEvent) {
  return function() {
    var args = Array.prototype.slice.call(arguments, 0)
    if (args.length > 0 && typeof args[args.length - 1] == 'function') {
      var cb = args[args.length - 1]
      args[args.length - 1] = function(dummyParam) {
        cb.apply(this, arguments)
      }
    }

    args.unshift(gameEvent)
    siteSockets.emit.apply(siteSockets, args)
  }
}

psi.on('shutdown', function() {
  httpServer.close()
  log.verbose('httpServer closed')
  localSettings.stopWatching()
  log.verbose('localSettings stopped watching')
})

siteSockets.on('connection', function(socket) {
  console.log('site client connected.')
  socket.on('launch', function(cb) {
    doLaunch(cb)
  }).on('disconnect', function() {
    console.log('site client disconnected.')
  }).on('resolution', function(cb) {
    detectResolution(cb)
  }).on('settings/set', function(newSettings, cb) {
    localSettings.setSettings(newSettings)
    siteSockets.except(socket.id).emit('settings/change', newSettings)
    cb()
  }).on('settings/get', function(cb) {
    cb(null, localSettings.getSettings())
  })

  ;[ 'setSettings'
  , 'hostMode'
  , 'joinMode'
  , 'createLobby'
  , 'joinLobby'
  , 'setRace'
  , 'addComputer'
  , 'startGame'
  , 'quit'
  ].forEach(function(command) {
    socket.on('game/' + command, passThrough(command))
  })
})

io.of('/game').on('connection', function(socket) {
  console.log('game client connected.')
  siteSockets.emit('game/connected')
  gameSocket = socket
  socket.on('disconnect', function() {
    console.log('game client disconnected.')
    siteSockets.emit('game/disconnected')
    gameSocket = null
  })

  ;[ 'playerJoined'
  , 'gameStarted'
  , 'gameFinished'
  ].forEach(function(command) {
    socket.on(command, passBack('game/' + command))
  })
})

function awaitGameConnection(timeout, cb) {
  if (gameSocket) {
    return cb(false)
  }
  io.of('/game').once('connection', onConnection)
  var timeoutId = setTimeout(function() {
    io.of('/game').removeListener('connection', onConnection)
    cb(true)
  }, timeout)

  function onConnection() {
    clearTimeout(timeoutId)
    cb(false)
  }
}

function doLaunch(cb) {
  // TODO(tec27): we should also try to guess the install path as %ProgramFiles(x86)%/Starcraft and
  // %ProgramFiles%/Starcraft, and allow this to be set through the web interface as well
  var installPath = psi.getInstallPathFromRegistry()
  installPath = installPath || 'C:\\Program Files (x86)\\Starcraft'
  var appPath = installPath +
      (installPath.charAt(installPath.length - 1) == '\\' ? '' : '\\') +
      'Starcraft.exe'

  psi.launchProcess(
      { appPath: appPath
      , launchSuspended: true
      , currentDir: installPath
      }, function(err, proc) {
        if (err) return cb({ when: 'launching process', msg: err.message })

        console.log('Process launched!')
        var shieldbatteryDll = path.join(shieldbatteryRoot, 'shieldbattery.dll')

        proc.injectDll(shieldbatteryDll, 'OnInject', function(err) {
          if (err) return cb({ when: 'injecting dll', msg: err.message })

          console.log('Dll injected! Attempting to resume process...')

          var resumeErr = proc.resume()
          console.log('Process resumed!')
          if (resumeErr) return cb({ when: 'resuming process', msg: resumeErr.message })

          awaitGameConnection(5000, function(timedOut) {
            if (timedOut) {
              cb({ when: 'resuming process', msg: 'waiting for game connection timed out' })
            } else {
              cb()
            }
          })
        })
      })
}

function detectResolution(cb) {
  var res = psi.detectResolution()
  cb(res)
}

