import { EventEmitter } from 'node:events'
import path from 'node:path'
import { afterEach, expect, test, vi } from 'vitest'
import { LocalGameRequest } from '../../common/games/local-game'

const mocks = vi.hoisted(() => ({ fork: vi.fn() }))

vi.mock('electron', () => ({ app: {}, utilityProcess: { fork: mocks.fork } }))
vi.mock('../logger', () => ({ default: { error: () => {}, warning: () => {} } }))
vi.mock('../settings', () => ({ LocalSettingsManager: class {}, ScrSettingsManager: class {} }))
vi.mock('./active-game-manager', () => ({ ActiveGameManager: class {} }))
vi.mock('./game-server', () => ({ GameServer: class {} }))
vi.mock('./local-game-hub', () => ({ LocalGameHub: class {} }))
vi.mock('./map-store', () => ({ MapStore: class {} }))

import { LocalGameManager, validateRequest } from './local-game-manager'

function requestWith(replayName?: string): LocalGameRequest {
  return {
    map: {
      hash: 'a'.repeat(64),
      mapData: { format: 'scx', slots: 2, width: 128, height: 128, isEud: false },
    },
    player: { name: 'Player', race: 'r' },
    bots: [
      {
        id: 'debug-bot',
        name: 'Debug bot',
        replayName,
        race: 'p',
        // Validation requires absolute paths, which differ between the Windows app and CI runners.
        executable: path.resolve('bots', 'debug-bot.exe'),
        workingDirectory: path.resolve('bots'),
      },
    ],
  } as LocalGameRequest
}

test('local game requests without replay metadata remain valid', () => {
  expect(() => validateRequest(requestWith())).not.toThrow()
})

test.each(['', 'a'.repeat(25), 'bot\u0000name'])(
  'rejects an invalid replay name: %j',
  replayName => {
    expect(() => validateRequest(requestWith(replayName))).toThrow('Invalid local replay name')
  },
)

afterEach(() => {
  vi.useRealTimers()
  mocks.fork.mockReset()
})

function makeGameManager(initialState?: string) {
  let state = initialState
  let finish!: () => void
  const normalExit = new Promise<void>(resolve => {
    finish = resolve
  })
  const stop = vi.fn((graceful = false) => (graceful ? normalExit : Promise.resolve()))
  const game = Object.assign(new EventEmitter(), {
    getStatus: vi.fn(() => (state === undefined ? undefined : { state })),
    stop,
    setState: (nextState: string | undefined) => {
      state = nextState
    },
  })
  return { game, stop, finish }
}

function makeWorker() {
  const worker = Object.assign(new EventEmitter(), {
    kill: vi.fn(() => worker.emit('exit', 0)),
    postMessage: vi.fn(message => {
      if (message.type === 'stop') worker.emit('exit', 0)
    }),
  })
  return worker
}

type TestManager = {
  session?: Parameters<LocalGameManager['stopSession']>[0]
  getManager: LocalGameManager['getManager']
  stopSession: LocalGameManager['stopSession']
  startBot: LocalGameManager['startBot']
}

function shutdownFixture() {
  const manager = new LocalGameManager(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  ) as unknown as TestManager
  const game = makeGameManager()
  const worker = makeWorker()
  const dispose = vi.fn()
  const close = vi.fn()
  const session: Parameters<LocalGameManager['stopSession']>[0] = {
    status: { id: 'session', state: 'playing', playerGameId: 'human', botGameIds: ['bot'] },
    managers: [game.game as never],
    managersById: new Map([['bot', game.game as never]]),
    workers: [{ process: worker as never, exited: false }],
    detach: [],
    stopping: false,
    control: { endpoint: 'test', dispose },
    hub: { close } as never,
  }
  return { manager, session, ...game, worker, dispose, close }
}

function botFixture(state = 'playing') {
  const manager = new LocalGameManager(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  ) as unknown as TestManager
  const game = makeGameManager(state)
  const worker = makeWorker()
  mocks.fork.mockReturnValueOnce(worker)
  const session: Parameters<LocalGameManager['startBot']>[0] = {
    status: { id: 'session', state: 'playing', playerGameId: 'human', botGameIds: ['bot'] },
    managers: [game.game as never],
    managersById: new Map([['bot', game.game as never]]),
    workers: [],
    detach: [],
    stopping: false,
  }
  const fail = vi.fn()
  return { manager, game, worker, session, fail }
}

async function startBot(f: ReturnType<typeof botFixture>) {
  const started = f.manager.startBot(
    f.session,
    f.game.game as never,
    {
      executable: 'C:\\bots\\debug-bot.exe',
      args: [],
      cwd: 'C:\\bots',
      instance: 'instance',
      logPath: 'C:\\bots\\debug.log',
    },
    f.fail,
  )
  f.worker.emit('message', { type: 'started' })
  await started
}

test('normal local shutdown keeps bot processes and transport alive until native exit', async () => {
  const f = shutdownFixture()
  const stopped = f.manager.stopSession(f.session)
  await Promise.resolve()
  expect(f.stop).toHaveBeenCalledExactlyOnceWith(true)
  expect(f.dispose).not.toHaveBeenCalled()
  expect(f.close).not.toHaveBeenCalled()
  expect(f.worker.postMessage).not.toHaveBeenCalled()
  f.finish()
  await stopped
  expect(f.stop).toHaveBeenLastCalledWith()
  expect(f.dispose).toHaveBeenCalledOnce()
  expect(f.close).toHaveBeenCalledOnce()
  expect(f.worker.postMessage).toHaveBeenCalledExactlyOnceWith({ type: 'stop' })
  expect(f.session.status.state).toBe('finished')
})

test('a normal bot exit waits for its game result and ignores the supervisor exit', async () => {
  const f = botFixture()
  await startBot(f)
  f.worker.emit('message', { type: 'exit', code: 0 })
  f.worker.emit('exit', 0)
  expect(f.fail).not.toHaveBeenCalled()
  expect(f.game.game.listenerCount('gameStatus')).toBe(1)

  f.game.game.setState('hasResult')
  f.game.game.emit('gameStatus', f.game.game.getStatus())
  await Promise.resolve()
  expect(f.game.game.listenerCount('gameStatus')).toBe(0)
  expect(f.game.game.listenerCount('gameExit')).toBe(0)
  expect(f.fail).not.toHaveBeenCalled()
})

test('a normal bot exit without a result fails at the bounded deadline', async () => {
  vi.useFakeTimers()
  const f = botFixture()
  await startBot(f)
  f.worker.emit('message', { type: 'exit', code: 0 })
  await vi.advanceTimersByTimeAsync(3000)
  expect(f.fail).toHaveBeenCalledOnce()
  expect(f.fail.mock.calls[0][0].message).toContain('before reporting a game result')
})

test('a nonzero bot exit fails immediately', async () => {
  const f = botFixture()
  await startBot(f)
  f.worker.emit('message', { type: 'exit', code: 1 })
  expect(f.fail).toHaveBeenCalledOnce()
  expect(f.fail.mock.calls[0][0].message).toContain('(1)')
})

test('bot supervision uses a utility process without enabling Electron Node mode', async () => {
  const f = botFixture()
  await startBot(f)
  expect(mocks.fork).toHaveBeenCalledExactlyOnceWith(
    path.join(__dirname, 'local-bot-worker.js'),
    [],
    { stdio: 'ignore', serviceName: 'Local bot supervisor' },
  )
  expect(f.worker.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'start' }))
})

test('a supervisor exit before startup rejects even during cancellation', async () => {
  const pendingFixture = botFixture()
  const pending = pendingFixture.manager.startBot(
    pendingFixture.session,
    pendingFixture.game.game as never,
    { executable: 'bot.exe', args: [], cwd: 'bots', instance: 'test', logPath: 'bot.log' },
    pendingFixture.fail,
  )
  pendingFixture.session.stopping = true
  pendingFixture.worker.emit('exit', 1)
  await expect(pending).rejects.toThrow('Bot process supervisor exited')
  expect(pendingFixture.fail).not.toHaveBeenCalled()
})

test('a supervisor that never starts its bot rejects at the startup deadline', async () => {
  vi.useFakeTimers()
  const f = botFixture()
  const pending = f.manager.startBot(
    f.session,
    f.game.game as never,
    { executable: 'bot.exe', args: [], cwd: 'bots', instance: 'test', logPath: 'bot.log' },
    f.fail,
  )
  const failure = pending.catch((error: unknown) => error)
  await vi.advanceTimersByTimeAsync(10000)
  expect(await failure).toEqual(new Error('Bot process launch timed out'))
  expect(f.fail).toHaveBeenCalledOnce()
})

test('utility process fatal errors are reported as supervisor failures', async () => {
  const f = botFixture()
  await startBot(f)
  f.worker.emit('error', 'FatalError', 'location', 'diagnostic report')
  expect(f.fail.mock.calls[0][0]).toBeInstanceOf(Error)
  expect(f.fail.mock.calls[0][0].message).toBe('Bot process supervisor failed: FatalError')
})

test('an unexpected supervisor exit fails an active match', async () => {
  const f = botFixture()
  await startBot(f)
  f.worker.emit('exit', 1)
  expect(f.fail).toHaveBeenCalledOnce()
  expect(f.fail.mock.calls[0][0].message).toBe('Bot process supervisor exited')
  expect(f.session.workers[0].exited).toBe(true)
})

test('cleanup terminates a supervisor that does not acknowledge stop', async () => {
  vi.useFakeTimers()
  const f = shutdownFixture()
  f.worker.postMessage.mockImplementation(() => {})
  const stopped = f.manager.stopSession(f.session, new Error('Canceled'))
  await vi.advanceTimersByTimeAsync(2499)
  expect(f.worker.kill).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(1)
  await stopped
  expect(f.worker.kill).toHaveBeenCalledOnce()
})

test('cleanup skips a supervisor whose exit was already observed', async () => {
  const f = shutdownFixture()
  f.session.workers[0].exited = true
  await f.manager.stopSession(f.session, new Error('Bot failed'))
  expect(f.worker.postMessage).not.toHaveBeenCalled()
  expect(f.worker.kill).not.toHaveBeenCalled()
})

test('a supervisor with no exit notification cannot keep the session stopping forever', async () => {
  vi.useFakeTimers()
  const f = shutdownFixture()
  f.session.status.state = 'launching'
  f.worker.postMessage.mockImplementation(() => {})
  f.worker.kill.mockReturnValue(false)
  const stopped = f.manager.stopSession(f.session)
  await vi.advanceTimersByTimeAsync(2500)
  await stopped
  expect(f.session.status.state).toBe('error')
  expect(f.session.status.error).toContain('supervisor did not exit')
  expect(f.dispose).toHaveBeenCalledOnce()
})

test('registered manager lookup survives native process exit and a cleared status', () => {
  const f = shutdownFixture()
  f.manager.session = f.session
  f.game.setState(undefined)
  expect(f.manager.getManager('bot')).toBe(f.game)
  expect(f.manager.getManager('other')).toBeUndefined()
})

test('a client stop failure releases session resources and reports an error', async () => {
  const f = shutdownFixture()
  f.stop.mockRejectedValue(new Error('Game did not exit after stopping'))
  await f.manager.stopSession(f.session)
  expect(f.dispose).toHaveBeenCalledOnce()
  expect(f.close).toHaveBeenCalledOnce()
  expect(f.session.status.state).toBe('error')
})

test('resignation settling waits for every game result before graceful stops', async () => {
  const f = shutdownFixture()
  f.game.setState('playing')
  const stopped = f.manager.stopSession(f.session)
  expect(f.stop).not.toHaveBeenCalled()

  f.game.setState('hasResult')
  f.game.emit('gameStatus', f.game.getStatus())
  await Promise.resolve()
  expect(f.stop).toHaveBeenCalledExactlyOnceWith(true)
  f.finish()
  await stopped
})

test('resignation settling releases clients at its deadline', async () => {
  vi.useFakeTimers()
  const f = shutdownFixture()
  f.game.setState('playing')
  const stopped = f.manager.stopSession(f.session)
  await vi.advanceTimersByTimeAsync(999)
  expect(f.stop).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(1)
  expect(f.stop).toHaveBeenCalledExactlyOnceWith(true)
  f.finish()
  await stopped
})

test('a stalled normal exit falls back to forced cleanup at the deadline', async () => {
  vi.useFakeTimers()
  const f = shutdownFixture()
  const stopped = f.manager.stopSession(f.session)
  await vi.advanceTimersByTimeAsync(2499)
  expect(f.worker.postMessage).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(1)
  await stopped
  expect(f.stop).toHaveBeenLastCalledWith()
  expect(f.worker.postMessage).toHaveBeenCalledExactlyOnceWith({ type: 'stop' })
  expect(f.dispose).toHaveBeenCalledOnce()
})

test('failed local games bypass graceful exit and immediately release their resources', async () => {
  const f = shutdownFixture()
  await f.manager.stopSession(f.session, new Error('Bot failed'))
  expect(f.stop).toHaveBeenCalledExactlyOnceWith()
  expect(f.worker.postMessage).toHaveBeenCalledExactlyOnceWith({ type: 'stop' })
  expect(f.session.status.state).toBe('error')
})

test('session teardown cancels a pending normal bot exit wait', async () => {
  vi.useFakeTimers()
  const f = botFixture()
  await startBot(f)
  f.worker.emit('message', { type: 'exit', code: 0 })
  f.session.stopping = true
  for (const detach of f.session.detach) detach()
  await vi.advanceTimersByTimeAsync(1000)
  expect(f.game.game.listenerCount('gameStatus')).toBe(0)
  expect(f.game.game.listenerCount('gameExit')).toBe(0)
  expect(f.fail).not.toHaveBeenCalled()
})
