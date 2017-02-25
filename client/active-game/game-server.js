import log from '../logging/logger'
import activeGameManager from './active-game-manager-instance'
import { sendCommand, subscribeToCommands } from './game-command'
import { mergeLocalSettings } from '../settings/action-creators'
import { dispatch } from '../dispatch-registry'

let lastLog = -1
const logThrottle = 30000
function authorize(req, cb) {
  const origin = req.headers.origin
  // We only accept connections from the game (or at the very least, things that can control their
  // origin, i.e. not browsers)
  if (origin !== 'BROODWARS') {
    if (Date.now() - lastLog > logThrottle) {
      lastLog = Date.now()
      log.warning('Blocked a connection from an untrusted origin: ' + origin)
    }
    cb(null, false)
    return
  }
  cb(null, true)
}

function registerGameRoutes(nydus) {
  async function getGameId(data, next) {
    const id = data.get('client').conn.request.headers['x-game-id']
    const newData = data.set('gameId', id)
    await next(newData)
  }

  async function onSetupProgress(data, next) {
    activeGameManager.handleSetupProgress(data.get('gameId'), data.get('body').status)
  }

  async function onStart(data, next) {
    activeGameManager.handleGameStart(data.get('gameId'))
  }

  async function onEnd(data, next) {
    const body = data.get('body')
    activeGameManager.handleGameEnd(data.get('gameId'), body.results, body.time)
  }

  async function onReplaySave(data, next) {
    const { path } = data.get('body')
    activeGameManager.handleReplaySave(data.get('gameId'), path)
  }

  async function onWindowMove(data, next) {
    const { x, y } = data.get('body')
    dispatch(mergeLocalSettings({ gameWinX: x, gameWinY: y }))
  }

  nydus.on('connection', socket => {
    const id = socket.conn.request.headers['x-game-id']
    subscribeToCommands(nydus, socket, id)
    activeGameManager.handleGameConnected(id)
  })

  nydus.registerRoute('/game/setupProgress', getGameId, onSetupProgress)
  nydus.registerRoute('/game/start', getGameId, onStart)
  nydus.registerRoute('/game/end', getGameId, onEnd)
  nydus.registerRoute('/game/replaySave', getGameId, onReplaySave)
  nydus.registerRoute('/game/windowMove', onWindowMove)

  activeGameManager.on('gameCommand', (id, command, payload) => {
    log.verbose(`Sending game command to ${id}: ${command}`)
    sendCommand(nydus, id, command, payload)
  })
}

function makeGameServer() {
  if (process.webpackEnv.SB_ENV !== 'electron') {
    return null
  }

  const nydus = require('nydus').default
  const http = require('http')
  const httpServer = http.createServer((req, res) => {
    res.writeHead(418)
    res.end('life of lively 2 live 2 life of full life thx 2 shieldbattery\n')
  }).listen(0, '127.0.0.1')

  const nydusServer = nydus(httpServer, { allowRequest: authorize })
  registerGameRoutes(nydusServer)

  httpServer.on('listening', () => {
    const { port } = httpServer.address()
    log.verbose('Game server listening on port ' + port)
    activeGameManager.setServerPort(port)
  })

  nydusServer.on('connection', function(socket) {
    log.verbose('game websocket connected')

    socket.on('close', function() {
      log.verbose('game websocket disconnected')
    })
  })

  return nydusServer
}

export default makeGameServer()
