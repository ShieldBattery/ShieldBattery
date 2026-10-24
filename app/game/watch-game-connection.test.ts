import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { watchGameConnection } from './watch-game-connection'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

test('unavailable measurements retry and a mismatch stops checks', async () => {
  const check = vi
    .fn<() => Promise<boolean | undefined>>()
    .mockResolvedValueOnce(undefined)
    .mockResolvedValueOnce(true)
    .mockResolvedValueOnce(false)
  const unavailable = vi.fn()
  const failure = vi.fn()
  watchGameConnection(check, unavailable, failure)
  await vi.advanceTimersByTimeAsync(360_000)
  expect(check).toHaveBeenCalledTimes(3)
  expect(unavailable).toHaveBeenCalledTimes(1)
  expect(failure).toHaveBeenCalledTimes(1)
})

test('pending checks neither overlap nor act after close', async () => {
  let reject!: (error: Error) => void
  const check = vi.fn(
    () =>
      new Promise<boolean>((_, r) => {
        reject = r
      }),
  )
  const failure = vi.fn()
  const stop = watchGameConnection(check, vi.fn(), failure)
  await vi.advanceTimersByTimeAsync(360_000)
  expect(check).toHaveBeenCalledTimes(1)
  stop()
  reject(new Error('disconnected'))
  await vi.advanceTimersByTimeAsync(360_000)
  expect(check).toHaveBeenCalledTimes(1)
  expect(failure).not.toHaveBeenCalled()
})

test('a mismatch from a closed connection cannot stop a subsequent game', async () => {
  let resolve!: (result: boolean) => void
  const check = vi.fn(() => new Promise<boolean>(r => (resolve = r)))
  const failure = vi.fn()
  const stop = watchGameConnection(check, vi.fn(), failure)
  stop()
  resolve(false)
  await vi.advanceTimersByTimeAsync(240_000)
  expect(failure).not.toHaveBeenCalled()
  expect(check).toHaveBeenCalledTimes(1)
})

test('unavailable imports or native modules keep retrying without stopping the game', async () => {
  const check = vi.fn(async () => undefined)
  const failure = vi.fn()
  const unavailable = vi.fn()
  watchGameConnection(check, unavailable, failure)
  await vi.advanceTimersByTimeAsync(360_000)
  expect(check).toHaveBeenCalledTimes(4)
  expect(failure).not.toHaveBeenCalled()
  expect(unavailable).toHaveBeenCalledTimes(4)
})

test.each([
  new Error('Import unavailable'),
  new TypeError('verifyGameConnection is not a function'),
  new TypeError('Missing socket port'),
])('unexpected failures retry as unavailable: %s', async error => {
  const check = vi.fn<() => Promise<boolean | undefined>>().mockRejectedValue(error)
  const failure = vi.fn()
  const unavailable = vi.fn()
  watchGameConnection(check, unavailable, failure)
  await vi.advanceTimersByTimeAsync(240_000)
  expect(check).toHaveBeenCalledTimes(3)
  expect(unavailable).toHaveBeenCalledTimes(3)
  expect(failure).not.toHaveBeenCalled()
})
