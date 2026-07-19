import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import createDeferred from './deferred'
import { extendableDeadline } from './extendable-deadline'

describe('common/async/extendableDeadline', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test('rejects at the base deadline when the tracked promise never settles', async () => {
    const pending = createDeferred<void>()
    const deadline = extendableDeadline(pending, 1000, 'timed out')
    const onRejected = vi.fn()
    deadline.expired.catch(onRejected)

    await vi.advanceTimersByTimeAsync(999)
    expect(onRejected).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(onRejected).toHaveBeenCalledTimes(1)
    expect(onRejected.mock.calls[0][0]).toBeInstanceOf(Error)
    expect(onRejected.mock.calls[0][0].message).toBe('timed out')
  })

  test('extend defers the rejection further out', async () => {
    const pending = createDeferred<void>()
    const deadline = extendableDeadline(pending, 1000)
    const onRejected = vi.fn()
    deadline.expired.catch(onRejected)

    await vi.advanceTimersByTimeAsync(500)
    deadline.extend(1000)

    // Past the original deadline, but the extension pushed it out.
    await vi.advanceTimersByTimeAsync(600)
    expect(onRejected).not.toHaveBeenCalled()

    // 1000 (base) + 1000 (extension) = 2000 total.
    await vi.advanceTimersByTimeAsync(900)
    expect(onRejected).toHaveBeenCalledTimes(1)
  })

  test('the tracked promise settling wins over the deadline', async () => {
    const pending = createDeferred<void>()
    const deadline = extendableDeadline(pending, 1000)
    const onRejected = vi.fn()
    const onResolved = vi.fn()
    deadline.expired.then(onResolved, onRejected)

    pending.resolve()
    await vi.advanceTimersByTimeAsync(0)
    expect(onResolved).toHaveBeenCalledTimes(1)
    expect(onRejected).not.toHaveBeenCalled()

    // The timer is cleared, so advancing past the deadline never rejects.
    await vi.advanceTimersByTimeAsync(2000)
    expect(onRejected).not.toHaveBeenCalled()
  })

  test('a tracked rejection also wins over the deadline', async () => {
    const pending = createDeferred<void>()
    pending.catch(() => {})
    const deadline = extendableDeadline(pending, 1000)
    const onRejected = vi.fn()
    const onResolved = vi.fn()
    deadline.expired.then(onResolved, onRejected)

    pending.reject(new Error('boom'))
    await vi.advanceTimersByTimeAsync(0)
    expect(onResolved).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(2000)
    expect(onRejected).not.toHaveBeenCalled()
  })

  test('extend is a no-op once the tracked promise has settled', async () => {
    const pending = createDeferred<void>()
    const deadline = extendableDeadline(pending, 1000)
    const onRejected = vi.fn()
    deadline.expired.catch(onRejected)

    pending.resolve()
    await vi.advanceTimersByTimeAsync(0)

    deadline.extend(5000)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(onRejected).not.toHaveBeenCalled()
  })
})
