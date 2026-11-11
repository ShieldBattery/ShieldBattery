import { EventEmitter } from 'node:events'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { GameLaunchConfig } from '../../common/games/game-launch-config'
import {
  DEFAULT_LOCAL_SETTINGS,
  DEFAULT_SCR_SETTINGS,
} from '../../common/settings/default-settings'
import { ActiveGameManager } from './active-game-manager'

const runtime = vi.hoisted(() => ({
  root: '',
  launch: vi.fn(),
  releaseGpu: vi.fn(),
  holdGpu: vi.fn(),
}))
vi.mock('electron', () => ({
  app: { getAppPath: () => 'C:\\fake-app', getPath: () => runtime.root },
  screen: { getAllDisplays: () => [] },
}))
vi.mock('electron-is-dev', () => ({ default: false }))
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
vi.mock('./gpu-preference', () => ({
  holdHighPerformanceGpu: (...args: unknown[]) => runtime.holdGpu(...args),
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
  runtime.releaseGpu.mockReset()
  runtime.holdGpu.mockReset().mockResolvedValue(runtime.releaseGpu)
  vi.spyOn(fs, 'access').mockResolvedValue()
  vi.spyOn(fs, 'realpath').mockImplementation(async p => String(p))
})
afterEach(async () => {
  vi.restoreAllMocks()
  await fs.rm(runtime.root, { recursive: true, force: true })
})

function createManager() {
  const settings = Object.assign(new EventEmitter(), {
    get: vi.fn(async () => ({
      ...DEFAULT_LOCAL_SETTINGS,
      preferHighPerformanceGpu: true,
      keepReplaysAlongsideGames: true,
      starcraftPath: 'C:\\StarCraft',
    })),
  })
  const scr = {
    gameFilepath: path.join(runtime.root, 'player-CSettings.json'),
    get: vi.fn(async () => DEFAULT_SCR_SETTINGS),
    writeGameSettingsFile: vi.fn(async () => {}),
    syncWithGameSettingsFile: vi.fn(async () => {}),
  }
  const mapStore = { getPath: () => path.join(runtime.root, 'test.scx') }
  const manager = new ActiveGameManager(mapStore as any, settings as any, scr as any)
  const config = {
    presentation: 'background',
    localUser: { id: 0, name: 'Test' },
    blockedUsers: [],
    serverConfig: { serverUrl: 'http://localhost' },
    setup: { gameId: 'test', map: { hash: 'test', mapData: { format: 'scx' } }, slots: [] },
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
  const lifecycle: string[] = []
  manager.on('gameProcessLaunching', id => lifecycle.push(`launch:${id}`))
  manager.on('gameProcessEnded', id => lifecycle.push(`end:${id}`))
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
  expect(lifecycle).toEqual([])
  expect(runtime.releaseGpu).not.toHaveBeenCalled()
  exit(0)
  await vi.waitFor(async () =>
    expect(await fs.readdir(path.join(runtime.root, 'background-games'))).toEqual([]),
  )
  expect(scr.syncWithGameSettingsFile).not.toHaveBeenCalled()
  expect(lifecycle).toEqual([])
  expect(runtime.holdGpu).not.toHaveBeenCalled()
  expect(runtime.releaseGpu).not.toHaveBeenCalled()
})

test('a background replay launches alongside other games with its own settings', async () => {
  let exit!: (code: number) => void
  runtime.launch.mockImplementation(async () => ({
    waitForExit: () =>
      new Promise<number>(resolve => {
        exit = resolve
      }),
  }))
  const { manager, config, scr } = createManager()
  const replayConfig = {
    ...config,
    setup: { ...config.setup, map: { isReplay: true, path: 'test.rep' } },
  } as unknown as GameLaunchConfig
  const commands: unknown[][] = []
  manager.on('gameCommand', (...args) => commands.push(args))
  manager.setGameConfig(replayConfig)
  await vi.waitFor(() => expect(runtime.launch).toHaveBeenCalledOnce())
  expect(runtime.launch.mock.calls[0][0].args).toContain('-sb-background')
  expect(manager.getStatus()).toBeNull()
  await manager.handleGameConnected('test')
  const payload = commands.find(([, command]) => command === 'settings')![2] as any
  expect(payload.settingsFilePath).not.toBe(scr.gameFilepath)
  expect(scr.get).not.toHaveBeenCalled()
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

test('a rejected exit wait stays retryable and clears the stop deadline', async () => {
  let retryExit!: (code: number) => void
  const wait = vi
    .fn()
    .mockRejectedValueOnce(new Error('Process wait failed'))
    .mockImplementation(() => new Promise<number>(resolve => (retryExit = resolve)))
  runtime.launch.mockResolvedValue({ waitForExit: wait })
  const { manager, config } = createManager()
  const failed = vi.spyOn(manager, 'handleGameExitWaitError')
  manager.setGameConfig(config)
  await vi.waitFor(() => expect(failed).toHaveBeenCalledOnce())
  vi.useFakeTimers()
  try {
    const stopped = manager.stop()
    await vi.advanceTimersByTimeAsync(0)
    retryExit(0)
    await stopped
    expect(wait).toHaveBeenCalledTimes(2)
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
  await vi.waitFor(() => expect(exit).toBeDefined())
  const stopped = manager.stop()
  await manager.handleGameConnected('test')
  expect(commands.filter(([, command]) => command === 'setupGame')).toHaveLength(0)
  expect(commands.at(-1)).toEqual(['test', 'quit'])
  exit(0)
  await stopped
  expect(manager.getStatus()).toBeNull()
})

test('background replay exit leaves foreground lifecycle and GPU hold intact', async () => {
  const exits: Array<(code: number) => void> = []
  runtime.launch.mockImplementation(async () => ({
    waitForExit: () => new Promise<number>(resolve => exits.push(resolve)),
  }))
  const { manager, config } = createManager()
  const lifecycle: string[] = []
  manager.on('gameProcessLaunching', id => lifecycle.push(`launch:${id}`))
  manager.on('gameProcessEnded', id => lifecycle.push(`end:${id}`))
  manager.setGameConfig({ ...config, presentation: undefined })
  await vi.waitFor(() => expect(exits).toHaveLength(1))
  manager.setGameConfig({
    ...config,
    setup: { ...config.setup, gameId: 'background', map: { isReplay: true, path: 'test.rep' } },
  } as unknown as GameLaunchConfig)
  await vi.waitFor(() => expect(exits).toHaveLength(2))
  expect(runtime.holdGpu).toHaveBeenCalledOnce()
  expect(lifecycle).toEqual(['launch:test'])
  exits[1](0)
  await vi.waitFor(async () =>
    expect(await fs.readdir(path.join(runtime.root, 'background-games'))).toEqual([]),
  )
  expect(runtime.releaseGpu).not.toHaveBeenCalled()
  expect(lifecycle).toEqual(['launch:test'])
  exits[0](0)
  await vi.waitFor(() => expect(lifecycle).toEqual(['launch:test', 'end:test']))
  expect(runtime.releaseGpu).toHaveBeenCalledOnce()
})

test('foreground injection failure balances lifecycle and releases GPU hold', async () => {
  runtime.launch.mockRejectedValue(new Error('Injection failed'))
  const { manager, config } = createManager()
  const lifecycle: string[] = []
  manager.on('gameProcessLaunching', id => lifecycle.push(`launch:${id}`))
  manager.on('gameProcessEnded', id => lifecycle.push(`end:${id}`))
  manager.setGameConfig({ ...config, presentation: undefined })
  await vi.waitFor(() => expect(lifecycle).toEqual(['launch:test', 'end:test']))
  expect(runtime.holdGpu).toHaveBeenCalledOnce()
  expect(runtime.releaseGpu).toHaveBeenCalledOnce()
})

test('failed background cleanup does not reject graceful stop', async () => {
  let exit!: (code: number) => void
  runtime.launch.mockImplementation(async () => ({
    waitForExit: () =>
      new Promise<number>(resolve => {
        exit = resolve
      }),
  }))
  const { manager, config } = createManager()
  manager.setGameConfig(config)
  await vi.waitFor(() => expect(exit).toBeDefined())
  vi.spyOn(fs, 'rm').mockRejectedValue(new Error('Directory locked'))
  manager.handleGameStart('test')
  const stopped = manager.stop(true)
  exit(0)
  await expect(stopped).resolves.toBeUndefined()
})

test('a hung game times out while retaining tracking and settings until observed exit', async () => {
  let exit!: (code: number) => void
  runtime.launch.mockResolvedValue({
    waitForExit: () => new Promise<number>(resolve => (exit = resolve)),
  })
  const { manager, config } = createManager()
  manager.setGameConfig(config)
  await vi.waitFor(() => expect(exit).toBeDefined())
  vi.useFakeTimers()
  try {
    const failure = manager.stop().catch(error => error)
    await vi.advanceTimersByTimeAsync(2000)
    expect(await failure).toMatchObject({
      message: expect.stringContaining('close the game manually'),
    })
    expect(manager.getStatus()?.id).toBe('test')
    expect(await fs.readdir(path.join(runtime.root, 'background-games'))).toHaveLength(1)
    const retry = manager.stop()
    exit(0)
    await retry
    expect(manager.getStatus()).toBeNull()
    expect(await fs.readdir(path.join(runtime.root, 'background-games'))).toEqual([])
  } finally {
    vi.useRealTimers()
  }
})

test('pending injection remains tracked after cancel and a late connection receives quit', async () => {
  let launched!: (process: unknown) => void
  let exit!: (code: number) => void
  runtime.launch.mockImplementation(() => new Promise(resolve => (launched = resolve)))
  const { manager, config } = createManager()
  const commands: unknown[][] = []
  manager.on('gameCommand', (...args) => commands.push(args))
  manager.setGameConfig(config)
  await vi.waitFor(() => expect(launched).toBeDefined())
  vi.useFakeTimers()
  try {
    const failure = manager.stop().catch(error => error)
    await vi.advanceTimersByTimeAsync(2000)
    expect(await failure).toBeInstanceOf(Error)
    expect(manager.getStatus()?.id).toBe('test')
    launched({ waitForExit: () => new Promise<number>(resolve => (exit = resolve)) })
    await vi.waitFor(() => expect(exit).toBeDefined())
    await manager.handleGameConnected('test')
    expect(commands.at(-1)).toEqual(['test', 'quit'])
    expect(commands.some(([, command]) => command === 'setupGame')).toBe(false)
    const retry = manager.stop()
    exit(0)
    await retry
    expect(manager.getStatus()).toBeNull()
  } finally {
    vi.useRealTimers()
  }
})

test('cancellation during preparation prevents late native creation', async () => {
  const { manager, config } = createManager()
  manager.setGameConfig(config)
  await manager.stop()
  expect(manager.getStatus()).toBeNull()
  await vi.waitFor(async () =>
    expect(await fs.readdir(path.join(runtime.root, 'background-games'))).toEqual([]),
  )
  expect(runtime.launch).not.toHaveBeenCalled()
})

test('a game with a result gets its exit grace period before receiving quit', async () => {
  let exit!: (code: number) => void
  runtime.launch.mockResolvedValue({
    waitForExit: () => new Promise<number>(resolve => (exit = resolve)),
  })
  const { manager, config } = createManager()
  const commands: unknown[][] = []
  manager.on('gameCommand', (...args) => commands.push(args))
  manager.setGameConfig(config)
  await vi.waitFor(() => expect(exit).toBeDefined())
  manager.handleGameResult('test', {}, 0)
  commands.length = 0
  vi.useFakeTimers()
  try {
    const stopped = manager.stop(true)
    await vi.advanceTimersByTimeAsync(1999)
    expect(commands).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    expect(commands).toEqual([['test', 'quit']])
    exit(0)
    await stopped
  } finally {
    vi.useRealTimers()
  }
})
