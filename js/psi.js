import log from './psi/logger'
process.on('uncaughtException', function(err) {
  log.error(err.stack)
  // give the log time to write out
  setTimeout(function() {
    process.exit()
  }, 100)
})

import path from 'path'
import fs from 'fs'
import { EventEmitter } from 'events'
import nydus from 'nydus'
import psi from './psi/natives/index'
import createHttpServer from './psi/http-server'
import createLocalSettings from './psi/local-settings'

const httpServer = createHttpServer(33198, '127.0.0.1')
const nydusServer = nydus(httpServer, { allowRequest: authorize })
const shieldbatteryRoot = path.dirname(process.execPath)
const localSettings = createLocalSettings(path.join(shieldbatteryRoot, 'settings.json'))
const socketTypes = new WeakMap()

const environment = {
  allowedHosts: [
    'https://shieldbattery.net',
    'https://www.shieldbattery.net',
    'https://dev.shieldbattery.net'
  ],
  updateUrl: 'https://shieldbattery.net/update',
  autoUpdate: true,
}
if (fs.existsSync(path.join(shieldbatteryRoot, 'dev.json'))) {
  const devEnv = require(path.join(shieldbatteryRoot, 'dev.json'))
  environment.allowedHosts = environment.allowedHosts.concat(devEnv.extraAllowedHosts || [])
  environment.updateUrl = devEnv.updateUrl || environment.updateUrl
  if (devEnv.autoUpdate !== undefined) {
    environment.autoUpdate = devEnv.autoUpdate
  }
}
log.verbose('environment:\n' + JSON.stringify(environment))

function authorize(req, cb) {
  const clientType = req.origin === 'BROODWARS' ? 'game' : 'site'
  if (clientType === 'site') {
    // ensure that this connection is coming from a site we trust
    if (!environment.allowedHosts.includes(req.origin)) {
      log.warning('Blocked a connection from an untrusted origin: ' + req.origin)
      return cb(null, false)
    }
  }
  // TODO(tec27): store clientType somewhere for this socket
  socketTypes.set(req, clientType)
  cb(null, true)
}

psi.on('shutdown', function() {
  httpServer.close()
  log.verbose('httpServer closed')
  localSettings.stopWatching()
  log.verbose('localSettings stopped watching')
})

let gameSocket = null
const gameConnectedEmitter = new EventEmitter()

nydus.on('connection', function(socket) {
  const clientType = socketTypes.get(socket.conn.request)
  log.verbose('websocket (' + clientType + ') connected.')
  if (clientType === 'game') {
    gameSocket = socket
    gameConnectedEmitter.emit('connected')
  }

  socket.on('disconnect', function() {
    log.verbose('websocket (' + clientType + ') disconnected.')
    if (gameSocket === socket) {
      nydus.publish('/game/disconnected')
      gameSocket = null
    }
  })
})

nydusServer.router.call('/launch', function(req, res) {
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

;[
  'setSettings',
  'createLobby',
  'joinLobby',
  'setRace',
  'addComputer',
  'startGame',
  'quit',
].forEach(command => {
  nydusServer.router.call('/game/' + command, function(/* req, res, params... */) {
    // pass through the calls directly to the game, and return responses back to the site
    const res = arguments[1]
    if (!gameSocket) {
      return res.fail(502, 'bad gateway', { msg: 'no game client connected.' })
    }

    const callArgs = [ '/' + command ].concat(Array.prototype.slice.call(arguments, 2))
    callArgs.push(function() {
      const err = arguments[0]
      if (err) {
        res.fail(err.code, err.desc, err.details)
      } else {
        res.complete.apply(res, Array.prototype.slice.call(arguments, 1))
      }
    })
    gameSocket.call.apply(gameSocket, callArgs)
  })
})

;[
  'playerJoined',
  'gameStarted',
  'gameFinished',
].forEach(command => {
  nydusServer.router.publish('/' + command, function(req, event, complete) {
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
  const timeoutId = setTimeout(function() {
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
  const installPath = psi.getInstallPathFromRegistry()
  installPath = installPath || 'C:\\Program Files (x86)\\Starcraft'
  const appPath = installPath +
      (installPath.charAt(installPath.length - 1) === '\\' ? '' : '\\') +
      'Starcraft.exe'

  psi.launchProcess({
    appPath,
    launchSuspended: true,
    currentDir: installPath,
  }, (err, proc) => {
    if (err) {
      return res.fail(500, 'internal server error',
          { when: 'launching process', msg: err.message })
    }

    log.verbose('Process launched')
    const shieldbatteryDll = path.join(shieldbatteryRoot, 'shieldbattery.dll')

    proc.injectDll(shieldbatteryDll, 'OnInject', function(err) {
      if (err) {
        return res.fail(500, 'internal server error',
            { when: 'injecting dll', msg: err.message })
      }

      log.verbose('Dll injected. Attempting to resume process...')

      const resumeErr = proc.resume()
      log.verbose('Process resumed')
      if (resumeErr) {
        return res.fail(500, 'internal server error',
            { when: 'resuming process', msg: resumeErr.message })
      }

      awaitGameConnection(100000, function(timedOut) {
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
