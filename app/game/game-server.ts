import { app, screen } from 'electron'
import http from 'http'
import { AddressInfo } from 'net'
import { randomUUID } from 'node:crypto'
import { container } from 'tsyringe'
import { WebSocket, WebSocketServer } from 'ws'
import { IN_GAME_REPORT_REASONS } from '../../common/ipc'
import { ALL_MINIMAP_COLOR_MODES, LocalSettings } from '../../common/settings/local-settings'
import { makeSbUserId } from '../../common/users/sb-user-id'
import log from '../logger'
import { LocalSettingsManager, ScrSettingsManager } from '../settings'
import { ActiveGameManager, gameDirectory } from './active-game-manager'
import { readInGameSettingsChange } from './in-game-settings'
import { watchGameConnection } from './watch-game-connection'

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
  private idToSocket = new Map<string, WebSocket>()
  private activeGameManager = container.resolve(ActiveGameManager)
  private managers = new Map<string, ActiveGameManager>()

  constructor(
    private server: WebSocketServer,
    private localSettings: LocalSettingsManager,
    private scrSettings: ScrSettingsManager,
  ) {
    this.attachManager(this.activeGameManager)
    this.attachServer(this.server)
  }

  registerManager(gameId: string, manager: ActiveGameManager): () => void {
    if (this.managers.has(gameId)) throw new Error('Game instance already registered')
    this.managers.set(gameId, manager)
    const detach = manager === this.activeGameManager ? () => {} : this.attachManager(manager)
    return () => {
      this.managers.delete(gameId)
      this.idToSocket.get(gameId)?.terminate()
      this.idToSocket.delete(gameId)
      detach()
    }
  }

  async createLocalControlPipe(): Promise<{ endpoint: string; dispose: () => void }> {
    const endpoint = `\\\\.\\pipe\\ShieldBattery.LocalControl.${randomUUID()}`
    const server = http.createServer()
    const ws = new WebSocketServer({ server, verifyClient: authorize })
    this.attachServer(ws)
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(endpoint, () => {
        server.removeListener('error', reject)
        resolve()
      })
    })
    server.on('error', error => log.error(`Local game control pipe failed: ${error}`))
    return {
      endpoint,
      dispose: () => {
        for (const socket of ws.clients) socket.terminate()
        ws.close()
        server.close()
      },
    }
  }

  private attachManager(manager: ActiveGameManager): () => void {
    const listener = (id: string, command: string, payload: unknown) => {
      const socket = this.idToSocket.get(id)
      if (socket?.readyState === WebSocket.OPEN) this.sendCommand(socket, command, payload)
    }
    manager.on('gameCommand', listener)
    return () => {
      manager.off('gameCommand', listener)
    }
  }

  private attachServer(server: WebSocketServer) {
    server.on('connection', (socket, request) => {
      const gameId = request.headers['x-game-id']
      if (gameId && !Array.isArray(gameId)) {
        log.verbose('game websocket connected')
        const serverPort = request.socket.localPort
        const clientPort = request.socket.remotePort
        const pingInterval = setInterval(() => {
          if (socket.readyState === socket.OPEN) socket.ping()
        }, 20000)
        const stopWatching = app.isPackaged
          ? watchGameConnection(
              async () => {
                if (serverPort === undefined || clientPort === undefined) return undefined
                const { verifyGameConnection } = await import('virtual:sb-security-impl')
                if (typeof verifyGameConnection !== 'function') return undefined
                return verifyGameConnection(gameDirectory, serverPort, clientPort, msg =>
                  log.error(msg),
                )
              },
              () => log.warning('Game connection check unavailable'),
              () => {
                log.error('Game connection check failed')
                if (socket.readyState === socket.OPEN) this.sendCommand(socket, 'quit', null)
                socket.close()
              },
            )
          : undefined
        socket.on('close', () => {
          log.verbose('game websocket disconnected')
          clearInterval(pingInterval)
          stopWatching?.()
          if (this.idToSocket.get(gameId) === socket) this.idToSocket.delete(gameId)
        })
        socket.on('message', data => {
          this.onMessage(gameId, data.toString())
        })
        socket.on('error', e => {
          log.error(`Game socket error ${String(e.stack ?? e)}`)
        })
        this.idToSocket.set(gameId, socket)
        ;(this.managers.get(gameId) ?? this.activeGameManager)
          .handleGameConnected(gameId)
          .catch(err => {
            log.error(`error handling game connection: ${err.stack ?? err}`)
          })
      }
    })
    server.on('error', e => {
      log.error(`Game server error ${String(e.stack ?? e)}`)
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
    const manager = this.managers.get(gameId) ?? this.activeGameManager
    const { command, payload } = JSON.parse(message)
    switch (command) {
      case '/game/setupProgress':
        manager.handleSetupProgress(gameId, payload.status)
        break
      case '/game/start':
        manager.handleGameStart(gameId)
        break
      case '/game/result':
        manager.handleGameResult(gameId, payload.results, payload.time, payload.tempReplayPath)
        break
      case '/game/finished':
        manager.handleGameFinished(gameId)
        break
      case '/game/replaySaved':
        manager.handleReplaySaved(gameId, payload.path)
        break
      case '/game/setUserBlocked':
        {
          const { userId, blocked } = payload
          // Validate before acting: this is a local websocket command boundary, and the request
          // is forwarded to the server as the logged-in user.
          if (Number.isSafeInteger(userId) && userId > 0 && typeof blocked === 'boolean') {
            this.activeGameManager.handleSetUserBlocked(gameId, makeSbUserId(userId), blocked)
          } else {
            log.error(`Invalid setUserBlocked payload from game ${gameId}`)
          }
        }
        break
      case '/game/reportPlayer':
        {
          const { userId, reason, gameSeconds } = payload
          // Validate before acting: the report is filed with the server as the logged-in user.
          if (
            Number.isSafeInteger(userId) &&
            userId > 0 &&
            IN_GAME_REPORT_REASONS.includes(reason) &&
            Number.isSafeInteger(gameSeconds) &&
            gameSeconds >= 0
          ) {
            this.activeGameManager.handleReportPlayer(gameId, {
              userId: makeSbUserId(userId),
              reason,
              gameSeconds,
            })
          } else {
            log.error(`Invalid reportPlayer payload from game ${gameId}`)
          }
        }
        break
      case '/game/replayUploaded':
        manager.handleReplayUploaded(gameId)
        break
      case '/game/replayRejected':
        if (typeof payload?.code === 'string') {
          this.activeGameManager.handleReplayRejected(gameId, payload.code)
        } else {
          log.error(`Invalid replayRejected payload from game ${gameId}`)
        }
        break
      case '/game/networkStatus':
        manager.handleNetworkStatus(gameId, payload)
        break
      case '/game/debug/state':
        manager.handleDebugState(gameId, payload)
        break
      case '/game/debug/screenshot':
        manager.handleDebugScreenshot(gameId, payload)
        break
      case '/game/windowMove':
        {
          const { x, y, w, h } = payload

          const toMerge: Partial<LocalSettings> = { gameWinX: x, gameWinY: y }
          if (w !== -1) {
            toMerge.gameWinWidth = w
          }
          if (h !== -1) {
            toMerge.gameWinHeight = h
          }

          this.localSettings.merge(toMerge).catch(err => {
            log.error(`Error saving game window position: ${err.stack ?? err}`)
          })
        }
        break
      case '/game/minimapSettings':
        {
          const { colorMode, terrainHidden } = payload

          // Validate before persisting: this is a local websocket command boundary, and corrupt
          // values would flow back into the UI and future game launches.
          const toMerge: Partial<LocalSettings> = {}
          if (ALL_MINIMAP_COLOR_MODES.includes(colorMode)) {
            toMerge.minimapColorMode = colorMode
          }
          if (typeof terrainHidden === 'boolean') {
            toMerge.minimapTerrainHidden = terrainHidden
          }

          if (Object.keys(toMerge).length > 0) {
            this.localSettings.merge(toMerge).catch(err => {
              log.error(`Error saving minimap settings: ${err.stack ?? err}`)
            })
          }
        }
        break
      case '/game/settingsChanged':
        {
          const { change, rejected } = readInGameSettingsChange(payload)
          if (rejected.length) {
            log.error(`Ignored invalid in-game settings from ${gameId}: ${rejected.join(', ')}`)
          }
          const local = { ...change.local }
          if (change.monitor !== undefined) {
            const bounds = change.monitor
            // The game names a display by where it sits in physical pixels; the app keeps the id
            // Electron gives it, and Electron places displays in DIPs.
            local.monitorId =
              bounds === null
                ? undefined
                : screen.getDisplayMatching(screen.screenToDipRect(null, bounds)).id
          }
          if (Object.keys(local).length > 0) {
            this.localSettings.merge(local).catch(err => {
              log.error(`Error saving in-game local settings: ${err.stack ?? err}`)
            })
          }
          if (Object.keys(change.scr).length > 0) {
            this.scrSettings.mergeFromGame(change.scr).catch(err => {
              log.error(`Error saving in-game SC:R settings: ${err.stack ?? err}`)
            })
          }
        }
        break
      default:
        log.error(`Received an unknown command '${command}' from ${gameId}`)
    }
  }
}

export default function createGameServer(
  localSettings: LocalSettingsManager,
  scrSettings: ScrSettingsManager,
) {
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

  const gameServer = new GameServer(wsServer, localSettings, scrSettings)

  return gameServer
}
