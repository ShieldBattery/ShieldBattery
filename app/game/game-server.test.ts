import { EventEmitter } from 'node:events'
import { container } from 'tsyringe'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { ActiveGameManager, gameDirectory } from './active-game-manager'
import { GameServer } from './game-server'
import { watchGameConnection } from './watch-game-connection'

const { verifyGameConnection, stopWatching, electronApp } = vi.hoisted(() => ({
  verifyGameConnection: vi.fn(),
  electronApp: { isPackaged: true },
  stopWatching: vi.fn(),
}))
vi.mock('electron', () => ({ app: electronApp, screen: {} }))
vi.mock('electron-is-dev', () => ({ default: false }))
vi.mock('../../common/ipc', () => ({ IN_GAME_REPORT_REASONS: [] }))
vi.mock('virtual:sb-security-impl', () => ({ verifyGameConnection }))
vi.mock('./watch-game-connection', () => ({ watchGameConnection: vi.fn(() => stopWatching) }))
vi.mock('./active-game-manager', () => ({
  ActiveGameManager: class {},
  gameDirectory: 'C:\\game',
}))
vi.mock('../logger', () => ({
  default: { verbose: vi.fn(), warning: vi.fn(), error: vi.fn() },
}))
vi.mock('../settings', () => ({ LocalSettingsManager: class {}, ScrSettingsManager: class {} }))

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  verifyGameConnection.mockResolvedValue(true)
})

afterEach(() => {
  electronApp.isPackaged = true
  container.clearInstances()
  vi.useRealTimers()
})

function connect() {
  const manager = Object.assign(new EventEmitter(), {
    handleGameConnected: vi.fn(async () => {}),
  })
  container.registerInstance(ActiveGameManager, manager as any)
  const server = new EventEmitter()
  const gameServer = new GameServer(server as any, {} as any, {} as any)
  const socket = Object.assign(new EventEmitter(), {
    OPEN: 1,
    readyState: 1,
    send: vi.fn(),
    ping: vi.fn(),
    close: vi.fn(() => socket.emit('close')),
  })
  server.emit('connection', socket, {
    headers: { 'x-game-id': 'test-game' },
    socket: { localPort: 1234, remotePort: 5678 },
  })
  return { socket, manager, gameServer }
}

test('packaged connections are watched and quit on a failed check', async () => {
  electronApp.isPackaged = true
  const { socket, manager } = connect()
  expect(manager.handleGameConnected).toHaveBeenCalledExactlyOnceWith('test-game')
  expect(watchGameConnection).toHaveBeenCalledTimes(1)
  const [check, , onFailure] = vi.mocked(watchGameConnection).mock.calls[0]
  await expect(check()).resolves.toBe(true)
  expect(verifyGameConnection).toHaveBeenCalledExactlyOnceWith(
    gameDirectory,
    1234,
    5678,
    expect.any(Function),
  )
  onFailure()
  expect(socket.send).toHaveBeenCalledExactlyOnceWith(
    JSON.stringify({ command: 'quit', payload: null }),
  )
  expect(socket.close).toHaveBeenCalledTimes(1)
  expect(stopWatching).toHaveBeenCalledTimes(1)
  expect(vi.getTimerCount()).toBe(0)
})

test('unpackaged connections remain usable without starting the private watcher', () => {
  electronApp.isPackaged = false
  const { socket, manager } = connect()
  expect(manager.handleGameConnected).toHaveBeenCalledExactlyOnceWith('test-game')
  expect(watchGameConnection).not.toHaveBeenCalled()
  expect(verifyGameConnection).not.toHaveBeenCalled()
  vi.advanceTimersByTime(20_000)
  expect(socket.ping).toHaveBeenCalledTimes(1)
  expect(socket.close).not.toHaveBeenCalled()
  socket.emit('close')
  expect(stopWatching).not.toHaveBeenCalled()
  expect(vi.getTimerCount()).toBe(0)
})
