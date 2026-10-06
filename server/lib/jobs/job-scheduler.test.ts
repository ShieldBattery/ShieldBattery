import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@prometheus-io/client', () => ({
  exponentialBuckets: () => [],
  Histogram: class {
    labels() {
      return { observe() {} }
    }
  },
}))
vi.mock('../logging/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { JobScheduler } from './job-scheduler'

const MAX_TIMEOUT_MS = 2 ** 31 - 1

function makeScheduler() {
  return new JobScheduler({ now: () => Date.now() } as any)
}

describe('jobs/job-scheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test('runs a one-off job once, at its start time', async () => {
    const scheduler = makeScheduler()
    const jobFn = vi.fn().mockResolvedValue(undefined)
    scheduler.scheduleJob('test', new Date(Date.now() + 5000), -1, jobFn)

    await vi.advanceTimersByTimeAsync(4999)
    expect(jobFn).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(jobFn).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(jobFn).toHaveBeenCalledTimes(1)
  })

  test('waits for start times beyond the longest setTimeout delay', async () => {
    const scheduler = makeScheduler()
    const jobFn = vi.fn().mockResolvedValue(undefined)
    const delay = MAX_TIMEOUT_MS * 2 + 1000
    scheduler.scheduleJob('test', new Date(Date.now() + delay), -1, jobFn)

    await vi.advanceTimersByTimeAsync(1)
    expect(jobFn).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(delay - 2)
    expect(jobFn).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(jobFn).toHaveBeenCalledTimes(1)
  })

  test('unscheduling a long-delayed job prevents it from running', async () => {
    const scheduler = makeScheduler()
    const jobFn = vi.fn().mockResolvedValue(undefined)
    const delay = MAX_TIMEOUT_MS * 2
    scheduler.scheduleJob('test', new Date(Date.now() + delay), -1, jobFn)

    await vi.advanceTimersByTimeAsync(MAX_TIMEOUT_MS + 1000)
    expect(scheduler.unscheduleJob('test')).toBe(true)
    await vi.advanceTimersByTimeAsync(delay)
    expect(jobFn).not.toHaveBeenCalled()
  })
})
