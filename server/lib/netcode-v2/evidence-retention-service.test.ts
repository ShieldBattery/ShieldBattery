import { afterEach, expect, test, vi } from 'vitest'
import { JobScheduler } from '../jobs/job-scheduler'
import { deleteExpiredGameSessionEvidenceChanges } from '../models/game-session-evidence-changes'
import { Clock } from '../time/clock'
import { EvidenceRetentionService } from './evidence-retention-service'

vi.mock('../models/game-session-evidence-changes', () => ({
  deleteExpiredGameSessionEvidenceChanges: vi.fn(),
}))

afterEach(() => vi.resetAllMocks())

function setup(now: () => number) {
  const scheduleImmediateJob = vi.fn()
  const service = new EvidenceRetentionService(
    { scheduleImmediateJob } as unknown as JobScheduler,
    { now } as Clock,
  )
  return { service, scheduleImmediateJob }
}

test('expires a bounded batch using the current time on each scheduled run', async () => {
  const now = vi.fn(() => Date.UTC(2026, 9, 24))
  const { scheduleImmediateJob } = setup(now)
  expect(scheduleImmediateJob).toHaveBeenCalledExactlyOnceWith(
    'lib/netcode-v2#expireEvidenceChanges',
    60 * 1000,
    expect.any(Function),
  )
  const run = scheduleImmediateJob.mock.calls[0][2] as () => Promise<void>
  await run()
  expect(deleteExpiredGameSessionEvidenceChanges).toHaveBeenLastCalledWith(
    new Date(Date.UTC(2026, 6, 26)),
  )
  now.mockReturnValue(Date.UTC(2026, 9, 25))
  await run()
  expect(deleteExpiredGameSessionEvidenceChanges).toHaveBeenLastCalledWith(
    new Date(Date.UTC(2026, 6, 27)),
  )
})

test('passes failures to the scheduler so its normal job error reporting applies', async () => {
  const { scheduleImmediateJob } = setup(() => Date.UTC(2026, 9, 24))
  const error = new Error('database unavailable')
  vi.mocked(deleteExpiredGameSessionEvidenceChanges).mockRejectedValueOnce(error)
  const run = scheduleImmediateJob.mock.calls[0][2] as () => Promise<void>
  await expect(run()).rejects.toBe(error)
})
