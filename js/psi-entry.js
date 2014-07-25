var log = require('./psi/logger')
process.on('uncaughtException', function(err) {
  log.error(err.stack)
  // give the log time to write out
  setTimeout(function() {
    process.exit()
  }, 100)
})

var psi = require('shieldbattery-psi')
  , path = require('path')
  , EventEmitter = require('events').EventEmitter
  , httpServer = require('./psi/http-server')(33198, '127.0.0.1')
  , nydus = require('nydus')(httpServer, { authorize: authorize })
  , shieldbatteryRoot = path.dirname(process.execPath)
  , localSettings = require('./psi/local-settings')(path.join(shieldbatteryRoot, 'settings.json'))

function authorize(info, cb) {
  // TODO(tec27): Don't allow any connections except from the game and from approved sites
  var clientType = info.origin == 'BROODWARS' ? 'game' : 'site'
  cb(true, { clientType: clientType })
}

psi.on('shutdown', function() {
  httpServer.close()
  log.verbose('httpServer closed')
  localSettings.stopWatching()
  log.verbose('localSettings stopped watching')
})

var gameSocket = null
  , gameConnectedEmitter = new EventEmitter()

nydus.on('connection', function(socket) {
  log.verbose('websocket (' + socket.handshake.clientType + ') connected.')
  if (socket.handshake.clientType == 'game') {
    gameSocket = socket
    gameConnectedEmitter.emit('connected')
  }

  socket.on('disconnect', function() {
    log.verbose('websocket (' + socket.handshake.clientType + ') disconnected.')
    if (socket.handshake.clientType == 'game') {
      nydus.publish('/game/disconnected')
      gameSocket = null
    }
  })
})

nydus.router.call('/launch', function(req, res) {
  doLaunch(req, res)
}).call('/getResolution', function(req, res) {
  detectResolution(req, res)
}).publish('/settings', function(req, newSettings, complete) {
  localSettings.setSettings(newSettings)
  complete(newSettings)
}).subscribe('/settings', function(req, res) {
  res.complete()
  req.socket.publish('/settings', localSettings.getSettings())
}).call('/getSettings', function(req, res) {
  res.complete(localSettings.getSettings())
})

;[ 'setSettings'
, 'createLobby'
, 'joinLobby'
, 'setRace'
, 'addComputer'
, 'startGame'
, 'quit'
].forEach(function(command) {
  nydus.router.call('/game/' + command, function(/*req, res, params...*/) {
    // pass through the calls directly to the game, and return responses back to the site
    var res = arguments[1]
    if (!gameSocket) {
      return res.fail(502, 'bad gateway', { msg: 'no game client connected.' })
    }

    var callArgs = [ '/' + command ].concat(Array.prototype.slice.call(arguments, 2))
    callArgs.push(function() {
      var err = arguments[0]
      if (err) {
        res.fail(err.code, err.desc, err.details);
      } else {
        res.complete.apply(res, Array.prototype.slice.call(arguments, 1))
      }
    })
    gameSocket.call.apply(gameSocket, callArgs)
  })
})

;[ 'playerJoined'
, 'gameStarted'
, 'gameFinished'
].forEach(function(command) {
  nydus.router.publish('/' + command, function(req, event, complete) {
    complete(event)
  }).subscribe('/' + command, function(req, res) {
    res.complete()
  })
})


function awaitGameConnection(timeout, cb) {
  if (gameSocket) {
    return cb(false)
  }
  gameConnectedEmitter.once('connected', onConnection)
  var timeoutId = setTimeout(function() {
    gameConnectedEmitter.removeListener('connected', onConnection)
    cb(true)
  }, timeout)

  function onConnection() {
    clearTimeout(timeoutId)
    cb(false)
  }
}

function doLaunch(req, res) {
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
        if (err) {
          return res.fail(500, 'internal server error',
              { when: 'launching process', msg: err.message })
        }

        log.verbose('Process launched')
        var shieldbatteryDll = path.join(shieldbatteryRoot, 'shieldbattery.dll')

        proc.injectDll(shieldbatteryDll, 'OnInject', function(err) {
          if (err) {
            return res.fail(500, 'internal server error',
                { when: 'injecting dll', msg: err.message })
          }

          log.verbose('Dll injected. Attempting to resume process...')

          var resumeErr = proc.resume()
          log.verbose('Process resumed')
          if (resumeErr) {
            return res.fail(500, 'internal server error',
                { when: 'resuming process', msg: resumeErr.message })
          }

          awaitGameConnection(5000, function(timedOut) {
            if (timedOut) {
              res.fail(504, 'gateway timeout',
                  { when: 'resuming process', msg: 'waiting for game connection timed out' })
            } else {
              res.complete()
            }
          })
        })
      })
}

function detectResolution(req, res) {
  psi.detectResolution(function(err, resolution) {
    if (err) {
      res.fail(502, 'bad gateway', { when: 'detecting resolution', msg: err.message })
    } else {
      res.complete(resolution)
    }
  })
}

