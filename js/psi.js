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
import nydus from 'nydus'
import psi from './psi/natives/index'
import createHttpServer from './psi/http-server'
import createLocalSettings from './psi/local-settings'
import { register as registerGameRoutes } from './psi/game-routes'
import { register as registerSiteRoutes, subscribe as subscribeSiteClient } from './psi/site-routes'
import { subscribeToCommands } from './psi/game-command'
import ActiveGameManager from './psi/active-game'

const httpServer = createHttpServer(33198, '127.0.0.1')
const nydusServer = nydus(httpServer, { allowRequest: authorize })
const shieldbatteryRoot = path.dirname(process.execPath)
const localSettings = createLocalSettings(path.join(shieldbatteryRoot, 'settings.json'))
const socketTypes = new WeakMap()
const activeGameManager = new ActiveGameManager()

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
  socketTypes.set(req, clientType)
  cb(null, true)
}

psi.on('shutdown', function() {
  nydusServer.close()
  log.verbose('nydusServer closed')
  httpServer.close()
  log.verbose('httpServer closed')
  localSettings.stopWatching()
  log.verbose('localSettings stopped watching')
})

registerSiteRoutes(nydusServer, localSettings, activeGameManager)
registerGameRoutes(nydusServer, activeGameManager)

nydusServer.on('connection', function(socket) {
  const clientType = socketTypes.get(socket.conn.request)
  log.verbose('websocket (' + clientType + ') connected.')
  if (clientType === 'game') {
    const id = socket.conn.request.headers['x-game-id']
    subscribeToCommands(nydusServer, socket, id)
    activeGameManager.handleGameConnected(id, socket)
  } else {
    subscribeSiteClient(nydusServer, socket, activeGameManager, localSettings)
  }

  socket.on('disconnect', function() {
    log.verbose('websocket (' + clientType + ') disconnected.')
    if (clientType === 'game') {
      const id = socket.conn.request.headers['x-game-id']
      activeGameManager.handleGameDisconnected(id)
    }
  })
})
