import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { GameLaunchConfig } from '../../common/games/game-launch-config'
import { GameStatus } from '../../common/games/game-status'
import {
  DEFAULT_LOCAL_SETTINGS,
  DEFAULT_SCR_SETTINGS,
} from '../../common/settings/default-settings'
import { ActiveGameManager } from './active-game-manager'

const runtime = vi.hoisted(() => ({ root: '', launch: vi.fn() }))
vi.mock('electron', () => ({
  app: { getAppPath: () => 'C:\\fake-app', getPath: () => runtime.root },
  screen: { getAllDisplays: () => [] },
}))
vi.mock('@shieldbattery/windows-registry', () => ({
  HKCU: 'HKCU',
  REG_SZ: 'REG_SZ',
  WindowsRegistry: class {
    async read() {
      return undefined
    }
  },
}))
vi.mock('../logger', () => ({
  default: { debug: vi.fn(), verbose: vi.fn(), warn: vi.fn(), warning: vi.fn(), error: vi.fn() },
}))
vi.mock('../log-paths', () => ({ gameLogBaseName: () => 'game-test' }))
vi.mock('./map-store', () => ({ MapStore: class {} }))
vi.mock('./check-starcraft-path', () => ({
  checkStarcraftPath: async () => ({ path: true, version: true }),
}))
vi.mock('./native/process/index', () => ({
  launchProcess: (...args: unknown[]) => runtime.launch(...args),
}))
vi.mock('../settings', () => ({
  LocalSettingsManager: class {},
  ScrSettingsManager: class {},
  fromBlizzardToSb: (settings: Record<string, unknown>) => ({
    hdGraphicsOn: settings.HDPreferences,
    soundOn: settings.SfxEnabled,
  }),
}))

beforeEach(async () => {
  runtime.root = await fs.mkdtemp(path.join(os.tmpdir(), 'sb-background-launch-'))
  runtime.launch.mockReset()
  vi.spyOn(fs, 'access').mockResolvedValue()
  vi.spyOn(fs, 'realpath').mockImplementation(async p => String(p))
})
afterEach(async () => {
  vi.restoreAllMocks()
  await fs.rm(runtime.root, { recursive: true, force: true })
})

function createManager() {
  const settings = {
    get: vi.fn(async () => ({ ...DEFAULT_LOCAL_SETTINGS, starcraftPath: 'C:\\StarCraft' })),
  }
  const scr = {
    gameFilepath: path.join(runtime.root, 'player-CSettings.json'),
    get: vi.fn(async () => DEFAULT_SCR_SETTINGS),
    writeGameSettingsFile: vi.fn(async () => {}),
    syncWithGameSettingsFile: vi.fn(async () => {}),
  }
  const manager = new ActiveGameManager({} as any, settings as any, scr as any)
  const config = {
    presentation: 'background',
    localUser: { id: 0, name: 'Test' },
    blockedUsers: [],
    serverConfig: { serverUrl: 'http://localhost' },
    setup: { gameId: 'test', map: { isReplay: true, path: 'test.rep' }, slots: [] },
  } as unknown as GameLaunchConfig
  return { manager, config, scr }
}

test('background launch uses its own settings through exit without reading or syncing player preferences', async () => {
  let exit!: (code: number) => void
  runtime.launch.mockImplementation(async () => ({
    waitForExit: () =>
      new Promise<number>(resolve => {
        exit = resolve
      }),
  }))
  const { manager, config, scr } = createManager()
  const commands: unknown[][] = []
  manager.on('gameCommand', (...args) => commands.push(args))
  manager.setGameConfig(config)
  await vi.waitFor(() => expect(runtime.launch).toHaveBeenCalledOnce())
  expect(runtime.launch.mock.calls[0][0].args).toContain('-sb-background')
  await manager.handleGameConnected('test')
  const payload = commands.find(([, command]) => command === 'settings')![2] as any
  expect(payload.local.disableHd).toBe(true)
  expect(payload.scr.hdGraphicsOn).toBe(false)
  expect(payload.scr.soundOn).toBe(false)
  expect(payload.settingsFilePath).not.toBe(scr.gameFilepath)
  expect(JSON.parse(await fs.readFile(payload.settingsFilePath, 'utf8')).HDPreferences).toBe(false)
  expect(scr.get).not.toHaveBeenCalled()
  expect(scr.writeGameSettingsFile).not.toHaveBeenCalled()
  exit(0)
  await vi.waitFor(async () =>
    expect(await fs.readdir(path.join(runtime.root, 'background-games'))).toEqual([]),
  )
  expect(scr.syncWithGameSettingsFile).not.toHaveBeenCalled()
})

test('failed injection removes the prepared background settings without touching player settings', async () => {
  runtime.launch.mockRejectedValue(new Error('Injection failed'))
  const { manager, config, scr } = createManager()
  manager.setGameConfig(config)
  await vi.waitFor(() => expect(runtime.launch).toHaveBeenCalledOnce())
  await vi.waitFor(async () =>
    expect(await fs.readdir(path.join(runtime.root, 'background-games'))).toEqual([]),
  )
  expect(scr.writeGameSettingsFile).not.toHaveBeenCalled()
  expect(scr.syncWithGameSettingsFile).not.toHaveBeenCalled()
})

test('failed exit wait retains the settings of a potentially surviving process', async () => {
  let rejectWait!: (error: Error) => void
  runtime.launch.mockImplementation(async () => ({
    waitForExit: () =>
      new Promise<number>((_, reject) => {
        rejectWait = reject
      }),
  }))
  const { manager, config, scr } = createManager()
  const commands: unknown[][] = []
  manager.on('gameCommand', (...args) => commands.push(args))
  manager.setGameConfig(config)
  await vi.waitFor(() => expect(runtime.launch).toHaveBeenCalledOnce())
  await manager.handleGameConnected('test')
  const payload = commands.find(([, command]) => command === 'settings')![2] as any
  rejectWait(new Error('Process wait failed'))
  await (manager as any).activeGame.promise
  expect(JSON.parse(await fs.readFile(payload.settingsFilePath, 'utf8')).HDPreferences).toBe(false)
  expect(scr.syncWithGameSettingsFile).not.toHaveBeenCalled()
})

test('graceful stop asks a playing game to leave before waiting for its exit', async () => {
  let exit!: (code: number) => void
  runtime.launch.mockImplementation(async () => ({
    waitForExit: () =>
      new Promise<number>(resolve => {
        exit = resolve
      }),
  }))
  const { manager, config } = createManager()
  const commands: unknown[][] = []
  manager.on('gameCommand', (...args) => commands.push(args))
  manager.setGameConfig(config)
  await vi.waitFor(() => expect(runtime.launch).toHaveBeenCalledOnce())
  manager.handleGameStart('test')

  const stopped = manager.stop(true)
  await vi.waitFor(() => expect(commands).toContainEqual(['test', 'leave']))
  expect(commands).not.toContainEqual(['test', 'quit'])

  exit(0)
  await stopped
})

test('graceful stop clears its deadline when the process promise rejects', async () => {
  const { manager } = createManager()
  const commands: unknown[][] = []
  manager.on('gameCommand', (...args) => commands.push(args))
  ;(manager as any).activeGame = {
    id: 'test',
    status: { state: GameStatus.Playing, extra: null },
    promise: Promise.reject(new Error('Process wait failed')),
  }

  vi.useFakeTimers()
  try {
    await expect(manager.stop(true)).rejects.toThrow('Process wait failed')
    expect(commands).toContainEqual(['test', 'leave'])
    expect(vi.getTimerCount()).toBe(0)
  } finally {
    vi.useRealTimers()
  }
})

test('canceling before the game connects sends quit instead of starting the canceled game', async () => {
  let exit!: (code: number) => void
  runtime.launch.mockImplementation(async () => ({
    waitForExit: () =>
      new Promise<number>(resolve => {
        exit = resolve
      }),
  }))
  const { manager, config } = createManager()
  const commands: unknown[][] = []
  manager.on('gameCommand', (...args) => commands.push(args))
  manager.setGameConfig(config)
  const stopped = manager.stop()
  await vi.waitFor(() => expect(exit).toBeDefined())
  await manager.handleGameConnected('test')
  expect(commands.filter(([, command]) => command === 'setupGame')).toHaveLength(0)
  expect(commands.at(-1)).toEqual(['test', 'quit'])
  exit(0)
  await stopped
  expect(manager.getStatus()).toBeNull()
})
