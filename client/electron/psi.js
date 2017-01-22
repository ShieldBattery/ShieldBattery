if (process.webpackEnv.SB_ENV !== 'electron') {
  throw new Error('This file should never be imported/required outside of the standalone app')
}

import log from './psi/logger'
process.on('uncaughtException', function(err) {
  console.error(err.stack)
  log.error(err.stack)
  // TODO(tec27): We used to exit here, what's the right thing now? Close window? Show error
  // dialog to user?
}).on('unhandledRejection', function(err) {
  log.error(err.stack)
  if (err instanceof TypeError || err instanceof SyntaxError || err instanceof ReferenceError) {
    // TODO(tec27): We used to exit here, what's the right thing now? Close window? Show error
    // dialog to user?
  }
  // Other promise rejections are likely less severe, leave the process up but log it
})

import { remote } from 'electron'
import path from 'path'
import nydus from 'nydus'
import createHttpServer from './psi/http-server'
import { register as registerGameRoutes } from './psi/game-routes'
import { register as registerSiteRoutes, subscribe as subscribeSiteClient } from './psi/site-routes'
import { subscribeToCommands } from './psi/game-command'
import ActiveGameManager from './psi/active-game'
import MapStore from './psi/map-store'
import RallyPointManager from './psi/rally-point-manager'

const httpServer = createHttpServer(33198, '127.0.0.1')
const nydusServer = nydus(httpServer, { allowRequest: authorize })

const mapDirPath = path.join(remote.app.getPath('userData'), 'maps')
const mapStore = new MapStore(mapDirPath)
const rallyPointManager = new RallyPointManager()

const socketTypes = new WeakMap()
const activeGameManager = new ActiveGameManager(nydusServer, mapStore)

let lastLog = -1
const logThrottle = 30000
function authorize(req, cb) {
  const origin = req.headers.origin
  const clientType = origin === 'BROODWARS' ? 'game' : 'site'
  if (clientType === 'site') {
    // ensure that this connection is coming from a site we trust
    if (origin !== undefined) {
      if (Date.now() - lastLog > logThrottle) {
        lastLog = Date.now()
        log.warning('Blocked a connection from an untrusted origin: ' + origin)
      }
      cb(null, false)
      return
    }
  }
  socketTypes.set(req, clientType)
  cb(null, true)
}

registerSiteRoutes(nydusServer, activeGameManager, mapStore, rallyPointManager)
registerGameRoutes(nydusServer, activeGameManager)

nydusServer.on('connection', function(socket) {
  const clientType = socketTypes.get(socket.conn.request)
  log.verbose('websocket (' + clientType + ') connected.')
  if (clientType === 'game') {
    const id = socket.conn.request.headers['x-game-id']
    subscribeToCommands(nydusServer, socket, id)
    activeGameManager.handleGameConnected(id)
  } else {
    // TODO(tec27): We need to pass an origin some other way, now that this will always be from
    // standalone clients and the origin will never be set (and never be equal to the server it's
    // talking to)
    const origin = socket.conn.request.headers.origin
    rallyPointManager.registerOrigin(origin)
    subscribeSiteClient(nydusServer, socket, activeGameManager)
  }

  socket.on('close', function() {
    if (clientType === 'site') {
      const origin = socket.conn.request.headers.origin
      rallyPointManager.unregisterOrigin(origin)
    }
    log.verbose('websocket (' + clientType + ') disconnected.')
  })
})
