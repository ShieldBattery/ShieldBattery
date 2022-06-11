import http from 'http'
import { Map } from 'immutable'
import { AddressInfo } from 'net'
import { container } from 'tsyringe'
import { WebSocket, WebSocketServer } from 'ws'
import { LocalSettingsData } from '../../common/local-settings'
import log from '../logger'
import { LocalSettings } from '../settings'
import { ActiveGameManager } from './active-game-manager'

interface AuthorizeInfo {
  origin: string
  secure: boolean
  req: http.IncomingMessage
}

let lastLog = -1
const logThrottle = 30000
function authorize(info: AuthorizeInfo): boolean {
  const origin = info.origin
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

export class GameServer {
  private idToSocket = Map<string, WebSocket>()
  private activeGameManager = container.resolve(ActiveGameManager)

  constructor(private server: WebSocketServer, private localSettings: LocalSettings) {
    this.activeGameManager.on('gameCommand', (id, command, payload) => {
      log.verbose(`Sending game command to ${id}: ${command}`)
      const socket = this.idToSocket.get(id)
      if (socket && socket.readyState === socket.OPEN) {
        this.sendCommand(socket, command, payload)
      } else {
        // Is this a bad error or something that commonly occurs? Guessing that it's common.
        log.verbose(`No game connection for ${id}`)
      }
    })

    this.server.on('connection', (socket, request) => {
      const gameId = request.headers['x-game-id']
      if (gameId && !Array.isArray(gameId)) {
        log.verbose('game websocket connected')
        const pingInterval = setInterval(() => {
          if (socket.readyState === socket.OPEN) socket.ping()
        }, 20000)
        socket.on('close', () => {
          log.verbose('game websocket disconnected')
          clearInterval(pingInterval)
          this.idToSocket = this.idToSocket.delete(gameId)
        })
        socket.on('message', data => {
          this.onMessage(gameId, data.toString())
        })
        socket.on('error', e => {
          log.error(`Game socket error ${e}`)
        })
        this.idToSocket = this.idToSocket.set(gameId, socket)
        this.activeGameManager.handleGameConnected(gameId).catch(err => {
          log.error(`error handling game connection: ${err.stack ?? err}`)
        })
      }
    })
    this.server.on('error', e => {
      log.error(`Game server error ${e}`)
    })
  }

  private sendCommand(socket: WebSocket, command: string, payload: any) {
    socket.send(
      JSON.stringify({
        command,
        payload,
      }),
    )
  }

  onMessage(gameId: string, message: string) {
    const { command, payload } = JSON.parse(message)
    switch (command) {
      case '/game/setupProgress':
        this.activeGameManager.handleSetupProgress(gameId, payload.status)
        break
      case '/game/start':
        this.activeGameManager.handleGameStart(gameId)
        break
      case '/game/result':
        this.activeGameManager.handleGameResult(gameId, payload.results, payload.time)
        break
      case '/game/resultSent':
        this.activeGameManager.handleGameResultSent(gameId)
        break
      case '/game/finished':
        this.activeGameManager.handleGameFinished(gameId)
        break
      case '/game/replaySave':
        this.activeGameManager.handleReplaySave(gameId, payload.path)
        break
      case '/game/windowMove':
        const { x, y, w, h } = payload

        const toMerge: Partial<LocalSettingsData> = { gameWinX: x, gameWinY: y }
        if (w !== -1) {
          toMerge.gameWinWidth = w
        }
        if (h !== -1) {
          toMerge.gameWinHeight = h
        }

        this.localSettings.merge(toMerge)
        break
      default:
        log.error(`Received an unknown command '${command}' from ${gameId}`)
    }
  }
}

export default function createGameServer(localSettings: LocalSettings) {
  const httpServer = http
    .createServer((req, res) => {
      res.writeHead(418)
      res.end('life of lively 2 live 2 life of full life thx 2 shieldbattery\n')
    })
    .listen(0, '127.0.0.1')

  const wsServer = new WebSocketServer({
    server: httpServer,
    verifyClient: authorize,
  })

  httpServer.on('listening', () => {
    const { port } = httpServer.address() as AddressInfo
    log.verbose('Game server listening on port ' + port)
    container.resolve(ActiveGameManager).setServerPort(port)
  })

  const gameServer = new GameServer(wsServer, localSettings)

  return gameServer
}
