import log from '../logging/logger'
import activeGameManager from './active-game-manager-instance'
import { mergeLocalSettings } from '../settings/action-creators'
import { dispatch } from '../dispatch-registry'

let lastLog = -1
const logThrottle = 30000
function authorize(req) {
  const origin = req.origin
  // We only accept connections from the game (or at the very least, things that can control their
  // origin, i.e. not browsers)
  if (origin !== 'BROODWARS') {
    if (Date.now() - lastLog > logThrottle) {
      lastLog = Date.now()
      log.warning('Blocked a connection from an untrusted origin: ' + origin)
    }
    return false
  }
  return true
}

class GameServer {
  constructor(server) {
    this.idToSocket = new Map()

    activeGameManager.on('gameCommand', (id, command, payload) => {
      log.verbose(`Sending game command to ${id}: ${command}`)
      const socket = this.idToSocket.get(id)
      if (socket) {
        this.sendCommand(socket, command, payload)
      } else {
        // Is this an bad error or something that commonly occurs? Guessing that it's common.
        log.verbose(`No game connection for ${id}`)
      }
    })

    server.on('connection', (socket, request) => {
      const gameIdIndex = request.rawHeaders.indexOf('x-game-id')
      if (gameIdIndex !== -1) {
        const gameId = request.rawHeaders[gameIdIndex + 1]
        log.verbose('game websocket connected')
        socket.on('close', () => {
          log.verbose('game websocket disconnected')
          this.idToSocket.delete(gameId)
        })
        socket.on('message', message => {
          this.onMessage(gameId, message)
        })
        this.idToSocket.set(gameId, socket)
        activeGameManager.handleGameConnected(gameId)
      }
    })
  }

  sendCommand(socket, command, payload) {
    socket.send(
      JSON.stringify({
        command,
        payload,
      }),
    )
  }

  onMessage(gameId, message) {
    const { command, payload } = JSON.parse(message)
    switch (command) {
      case '/game/setupProgress':
        activeGameManager.handleSetupProgress(gameId, payload.status)
        break
      case '/game/start':
        activeGameManager.handleGameStart(gameId)
        break
      case '/game/end':
        activeGameManager.handleGameEnd(gameId, payload.results, payload.time)
        break
      case '/game/replaySave':
        activeGameManager.handleReplaySave(gameId, payload.path)
        break
      case '/game/windowMove':
        const { x, y } = payload
        dispatch(mergeLocalSettings({ gameWinX: x, gameWinY: y }))
        break
      default:
        log.error(`Received an unknown command '${message.command}' from ${gameId}`)
    }
  }
}

function makeGameServer() {
  if (!IS_ELECTRON) {
    return null
  }

  const WebSocket = require('ws/index.js')
  const http = require('http')
  const httpServer = http
    .createServer((req, res) => {
      res.writeHead(418)
      res.end('life of lively 2 live 2 life of full life thx 2 shieldbattery\n')
    })
    .listen(0, '127.0.0.1')

  const wsServer = new WebSocket.Server({
    server: httpServer,
    verifyClient: info => authorize(info),
  })

  httpServer.on('listening', () => {
    const { port } = httpServer.address()
    log.verbose('Game server listening on port ' + port)
    activeGameManager.setServerPort(port)
  })

  const gameServer = new GameServer(wsServer)

  return gameServer
}

export default makeGameServer()
