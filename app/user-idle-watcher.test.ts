import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, Mock, test, vi } from 'vitest'
import {
  ACTIVE_POLL_INTERVAL_MS,
  DEFAULT_IDLE_THRESHOLD_MS,
  IDLE_POLL_INTERVAL_MS,
  UserIdleWatcher,
} from './user-idle-watcher'

class FakeIdleSource extends EventEmitter {
  idleSeconds = 0

  getSystemIdleTime() {
    return this.idleSeconds
  }
}

const THRESHOLD_SECONDS = DEFAULT_IDLE_THRESHOLD_MS / 1000

describe('app/user-idle-watcher', () => {
  let source: FakeIdleSource
  let watcher: UserIdleWatcher
  let onChange: Mock<(idle: boolean) => void>

  beforeEach(() => {
    vi.useFakeTimers()
    source = new FakeIdleSource()
    watcher = new UserIdleWatcher(source)
    onChange = vi.fn<(idle: boolean) => void>()
    watcher.on('change', onChange)
  })

  afterEach(() => {
    watcher.stop()
    vi.useRealTimers()
  })

  test('starts out active', () => {
    watcher.start()

    expect(watcher.isIdle()).toBe(false)
    expect(onChange).not.toHaveBeenCalled()
  })

  test('starts out idle if the system already is', () => {
    source.idleSeconds = THRESHOLD_SECONDS

    watcher.start()

    expect(watcher.isIdle()).toBe(true)
    expect(onChange).toHaveBeenCalledExactlyOnceWith(true)
  })

  test('becomes idle once the idle time reaches the threshold', () => {
    watcher.start()

    source.idleSeconds = THRESHOLD_SECONDS - 1
    vi.advanceTimersByTime(ACTIVE_POLL_INTERVAL_MS)
    expect(onChange).not.toHaveBeenCalled()

    source.idleSeconds = THRESHOLD_SECONDS
    vi.advanceTimersByTime(ACTIVE_POLL_INTERVAL_MS)
    expect(onChange).toHaveBeenCalledExactlyOnceWith(true)
    expect(watcher.isIdle()).toBe(true)
  })

  test('only reports transitions', () => {
    watcher.start()
    source.idleSeconds = THRESHOLD_SECONDS

    vi.advanceTimersByTime(ACTIVE_POLL_INTERVAL_MS)
    vi.advanceTimersByTime(IDLE_POLL_INTERVAL_MS * 5)

    expect(onChange).toHaveBeenCalledExactlyOnceWith(true)
  })

  test('notices input quickly while idle', () => {
    source.idleSeconds = THRESHOLD_SECONDS
    watcher.start()
    onChange.mockClear()

    source.idleSeconds = 0
    vi.advanceTimersByTime(IDLE_POLL_INTERVAL_MS)

    expect(onChange).toHaveBeenCalledExactlyOnceWith(false)
    expect(watcher.isIdle()).toBe(false)
  })

  test('uses a custom threshold', () => {
    watcher.stop()
    watcher = new UserIdleWatcher(source, 60_000)
    watcher.on('change', onChange)
    watcher.start()

    source.idleSeconds = 60
    vi.advanceTimersByTime(ACTIVE_POLL_INTERVAL_MS)

    expect(onChange).toHaveBeenCalledExactlyOnceWith(true)
  })

  test('is idle while the screen is locked, and active once it unlocks', () => {
    watcher.start()

    source.emit('lock-screen')
    expect(onChange).toHaveBeenLastCalledWith(true)

    // Polls while locked don't bring the user back, whatever the idle time says
    vi.advanceTimersByTime(IDLE_POLL_INTERVAL_MS * 3)
    expect(watcher.isIdle()).toBe(true)

    source.emit('unlock-screen')
    expect(onChange).toHaveBeenLastCalledWith(false)
    expect(onChange).toHaveBeenCalledTimes(2)
  })

  test('stops watching once stopped', () => {
    watcher.start()
    watcher.stop()

    source.idleSeconds = THRESHOLD_SECONDS
    vi.advanceTimersByTime(ACTIVE_POLL_INTERVAL_MS * 2)
    source.emit('lock-screen')

    expect(onChange).not.toHaveBeenCalled()
  })
})
