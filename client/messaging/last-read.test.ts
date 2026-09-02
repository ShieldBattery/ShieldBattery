import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  LAST_READ_COALESCE_MS,
  flushLastRead,
  reportLastRead,
  resetLastReadForTesting,
} from './last-read'

describe('messaging/last-read', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    resetLastReadForTesting()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test('leading edge: first report for a key sends immediately', () => {
    const send = vi.fn()

    reportLastRead('key', 100, send)

    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith(100)
  })

  test('trailing fold fires once, at the shortened delay relative to the last actual send', () => {
    const send = vi.fn()

    reportLastRead('key', 100, send) // t=0, leading
    expect(send).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(1000) // t=1000
    reportLastRead('key', 150, send) // folded; timer scheduled for t=1000+4000=5000
    expect(send).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(500) // t=1500
    reportLastRead('key', 200, send) // another rapid report; still folded into the same timer
    expect(send).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(3499) // t=4999, just short of the window
    expect(send).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(1) // t=5000
    expect(send).toHaveBeenCalledTimes(2)
    expect(send).toHaveBeenLastCalledWith(200)
  })

  test('a report at or before the last sent value is dropped and never sent, immediately or later', () => {
    const send = vi.fn()

    reportLastRead('key', 100, send) // t=0, leading
    expect(send).toHaveBeenCalledTimes(1)

    reportLastRead('key', 100, send) // equal to lastValue -> dropped
    reportLastRead('key', 50, send) // older than lastValue -> dropped
    expect(send).toHaveBeenCalledTimes(1)

    // Nothing was scheduled, so letting the window elapse must not produce a trailing send either.
    vi.advanceTimersByTime(LAST_READ_COALESCE_MS + 1000)
    expect(send).toHaveBeenCalledTimes(1)
  })

  test('a stale report while a trailing send is pending does not lower the scheduled value', () => {
    const send = vi.fn()

    reportLastRead('key', 100, send) // t=0, leading
    vi.advanceTimersByTime(1000) // t=1000
    reportLastRead('key', 300, send) // pending scheduled with lastValue=300, fires at t=5000
    reportLastRead('key', 200, send) // stale relative to the pending value -> dropped
    expect(send).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(4000) // t=5000
    expect(send).toHaveBeenCalledTimes(2)
    expect(send).toHaveBeenLastCalledWith(300)
  })

  test('newer reports while pending only raise the value: still one trailing send, with the newest value', () => {
    const send = vi.fn()

    reportLastRead('key', 100, send) // t=0, leading
    vi.advanceTimersByTime(1000) // t=1000
    reportLastRead('key', 200, send) // pending scheduled, fires at t=5000
    vi.advanceTimersByTime(500) // t=1500
    reportLastRead('key', 300, send) // still pending, just raises lastValue
    vi.advanceTimersByTime(500) // t=2000
    reportLastRead('key', 400, send) // still pending, just raises lastValue again
    expect(send).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(3000) // t=5000, the original timer fires
    expect(send).toHaveBeenCalledTimes(2)
    expect(send).toHaveBeenLastCalledWith(400)
  })

  test('a report after the window has fully elapsed with nothing pending is leading-edge again', () => {
    const send = vi.fn()

    reportLastRead('key', 100, send) // t=0, leading
    expect(send).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(LAST_READ_COALESCE_MS) // t=5000, exactly the window since the last send
    reportLastRead('key', 200, send)

    expect(send).toHaveBeenCalledTimes(2)
    expect(send).toHaveBeenLastCalledWith(200)
  })

  test('flushLastRead fires a pending trailing send immediately, exactly once, with the newest value', () => {
    const send = vi.fn()

    reportLastRead('key', 100, send) // t=0, leading
    vi.advanceTimersByTime(1000) // t=1000
    reportLastRead('key', 200, send) // pending, would otherwise fire at t=5000

    flushLastRead('key')

    expect(send).toHaveBeenCalledTimes(2)
    expect(send).toHaveBeenLastCalledWith(200)

    // The timer must have been cancelled, so letting the original window elapse fires nothing more.
    vi.advanceTimersByTime(LAST_READ_COALESCE_MS + 1000)
    expect(send).toHaveBeenCalledTimes(2)
  })

  test('flushLastRead with nothing pending is a no-op', () => {
    expect(() => flushLastRead('never-reported')).not.toThrow()

    const send = vi.fn()
    reportLastRead('key', 100, send) // leading send, nothing left pending

    expect(() => flushLastRead('key')).not.toThrow()
    expect(send).toHaveBeenCalledTimes(1)
  })

  test('flushLastRead after the trailing timer already fired is a no-op', () => {
    const send = vi.fn()

    reportLastRead('key', 100, send) // t=0, leading
    vi.advanceTimersByTime(1000) // t=1000
    reportLastRead('key', 200, send) // pending, fires at t=5000
    vi.advanceTimersByTime(4000) // t=5000, trailing send fires on its own
    expect(send).toHaveBeenCalledTimes(2)

    expect(() => flushLastRead('key')).not.toThrow()
    expect(send).toHaveBeenCalledTimes(2)
  })

  test('keys are independent: a pending window on one key does not delay a leading send on another', () => {
    const sendA = vi.fn()
    const sendB = vi.fn()

    reportLastRead('a', 100, sendA) // t=0, leading for a
    vi.advanceTimersByTime(1000) // t=1000
    reportLastRead('a', 200, sendA) // pending for a, fires at t=5000

    reportLastRead('b', 500, sendB) // b has no prior state, so this is leading-edge

    expect(sendB).toHaveBeenCalledTimes(1)
    expect(sendB).toHaveBeenCalledWith(500)
    expect(sendA).toHaveBeenCalledTimes(1)
  })

  test('the trailing send uses the callback captured when the pending entry was created', () => {
    const sendFirst = vi.fn()
    const sendSecond = vi.fn()

    reportLastRead('key', 100, sendFirst) // t=0, leading; calls sendFirst
    vi.advanceTimersByTime(1000) // t=1000
    reportLastRead('key', 200, sendFirst) // creates the pending entry, capturing sendFirst
    reportLastRead('key', 300, sendSecond) // still pending; only raises lastValue, doesn't replace the captured send

    vi.advanceTimersByTime(4000) // t=5000, trailing send fires

    expect(sendFirst).toHaveBeenCalledTimes(2)
    expect(sendFirst).toHaveBeenLastCalledWith(300)
    expect(sendSecond).not.toHaveBeenCalled()
  })

  test('a delivered position stays dropped when it is reported again', async () => {
    const send = vi.fn().mockResolvedValue(undefined)

    reportLastRead('key', 100, send) // t=0, leading
    await vi.advanceTimersByTimeAsync(0)

    vi.advanceTimersByTime(LAST_READ_COALESCE_MS) // t=5000, leading-edge again
    reportLastRead('key', 100, send)

    expect(send).toHaveBeenCalledTimes(1)
  })

  test('a failed send lets the next report carry the same position again', async () => {
    const send = vi.fn().mockRejectedValueOnce(new Error('request failed'))

    reportLastRead('key', 100, send) // t=0, leading; never reaches the server
    await vi.advanceTimersByTimeAsync(0)

    vi.advanceTimersByTime(LAST_READ_COALESCE_MS) // t=5000, leading-edge again
    reportLastRead('key', 100, send)

    expect(send).toHaveBeenCalledTimes(2)
    expect(send).toHaveBeenLastCalledWith(100)
  })

  test('a failed trailing send lets the next report carry its position again', async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('request failed'))

    reportLastRead('key', 100, send) // t=0, leading, delivered
    await vi.advanceTimersByTimeAsync(0)
    vi.advanceTimersByTime(1000) // t=1000
    reportLastRead('key', 200, send) // pending, fires at t=5000
    await vi.advanceTimersByTimeAsync(4000) // t=5000, trailing send fires and fails
    expect(send).toHaveBeenCalledTimes(2)

    vi.advanceTimersByTime(LAST_READ_COALESCE_MS) // t=10000, leading-edge again
    reportLastRead('key', 200, send)

    expect(send).toHaveBeenCalledTimes(3)
    expect(send).toHaveBeenLastCalledWith(200)
  })

  test('a failed send does not undo a newer position scheduled while it was in flight', async () => {
    let failSend: (err: Error) => void = () => {}
    const send = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            failSend = reject
          }),
      )
      .mockResolvedValueOnce(undefined)

    reportLastRead('key', 100, send) // t=0, leading, still in flight
    vi.advanceTimersByTime(1000) // t=1000
    reportLastRead('key', 200, send) // pending, fires at t=5000
    failSend(new Error('request failed'))
    await vi.advanceTimersByTimeAsync(0)

    await vi.advanceTimersByTimeAsync(4000) // t=5000

    expect(send).toHaveBeenCalledTimes(2)
    expect(send).toHaveBeenLastCalledWith(200)
  })

  test('a failed send does not undo a newer position that has already been delivered', async () => {
    let failSend: (err: Error) => void = () => {}
    const send = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            failSend = reject
          }),
      )
      .mockResolvedValueOnce(undefined)

    reportLastRead('key', 100, send) // t=0, leading, still in flight
    vi.advanceTimersByTime(LAST_READ_COALESCE_MS) // t=5000
    reportLastRead('key', 200, send) // leading-edge again, delivered
    await vi.advanceTimersByTimeAsync(0)
    failSend(new Error('request failed'))
    await vi.advanceTimersByTimeAsync(0)

    vi.advanceTimersByTime(LAST_READ_COALESCE_MS) // t=10000
    reportLastRead('key', 200, send) // 200 already reached the server, so nothing to re-send

    expect(send).toHaveBeenCalledTimes(2)
  })

  test('flushLastRead forgets a key with nothing scheduled', () => {
    const send = vi.fn()

    reportLastRead('key', 100, send) // t=0, leading, nothing left pending
    flushLastRead('key')

    // With no state left for the key, this report has nothing to be measured against and goes out
    // as a leading edge of its own.
    reportLastRead('key', 100, send)

    expect(send).toHaveBeenCalledTimes(2)
  })
})
