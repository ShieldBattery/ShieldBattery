import { afterEach, expect, test, vi } from 'vitest'
import { JobScheduler } from '../jobs/job-scheduler'
import { deleteExpiredGameSessionEvidence } from '../models/game-session-evidence'
import { deleteExpiredGameSessionEvidenceChanges } from '../models/game-session-evidence-changes'
import { deleteExpiredGameSessionPeriodicEvidence } from '../models/game-session-periodic-evidence'
import { Clock } from '../time/clock'
import { EvidenceRetentionService } from './evidence-retention-service'

vi.mock('../models/game-session-evidence', () => ({
  deleteExpiredGameSessionEvidence: vi.fn(),
}))

vi.mock('../models/game-session-periodic-evidence', () => ({
  deleteExpiredGameSessionPeriodicEvidence: vi.fn(),
}))

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
  expect(scheduleImmediateJob).toHaveBeenNthCalledWith(
    1,
    'lib/netcode-v2#expireEvidenceChanges',
    60 * 1000,
    expect.any(Function),
  )
  const run = scheduleImmediateJob.mock.calls[0][2] as () => Promise<void>
  await run()
  expect(deleteExpiredGameSessionEvidenceChanges).toHaveBeenLastCalledWith(
    new Date(Date.UTC(2026, 8, 24)),
  )
  now.mockReturnValue(Date.UTC(2026, 9, 25))
  await run()
  expect(deleteExpiredGameSessionEvidenceChanges).toHaveBeenLastCalledWith(
    new Date(Date.UTC(2026, 8, 25)),
  )
})

test('passes failures to the scheduler so its normal job error reporting applies', async () => {
  const { scheduleImmediateJob } = setup(() => Date.UTC(2026, 9, 24))
  const error = new Error('database unavailable')
  vi.mocked(deleteExpiredGameSessionEvidenceChanges).mockRejectedValueOnce(error)
  const run = scheduleImmediateJob.mock.calls[0][2] as () => Promise<void>
  await expect(run()).rejects.toBe(error)
})

test('expires each ingestion table 7 days after receipt as its own job', async () => {
  const now = vi.fn(() => Date.UTC(2026, 9, 24))
  const { scheduleImmediateJob } = setup(now)
  expect(scheduleImmediateJob).toHaveBeenCalledTimes(3)
  expect(scheduleImmediateJob).toHaveBeenCalledWith(
    'lib/netcode-v2#expireIngestedEvidence',
    60 * 1000,
    expect.any(Function),
  )
  expect(scheduleImmediateJob).toHaveBeenCalledWith(
    'lib/netcode-v2#expireIngestedPeriodicEvidence',
    60 * 1000,
    expect.any(Function),
  )
  const runs = scheduleImmediateJob.mock.calls.map(call => call[2] as () => Promise<void>)
  await Promise.all(runs.map(run => run()))
  expect(deleteExpiredGameSessionEvidence).toHaveBeenLastCalledWith(new Date(Date.UTC(2026, 9, 17)))
  expect(deleteExpiredGameSessionPeriodicEvidence).toHaveBeenLastCalledWith(
    new Date(Date.UTC(2026, 9, 17)),
  )
  now.mockReturnValue(Date.UTC(2026, 9, 25))
  await Promise.all(runs.map(run => run()))
  expect(deleteExpiredGameSessionEvidence).toHaveBeenLastCalledWith(new Date(Date.UTC(2026, 9, 18)))
})

test('a failing ingestion job does not affect the other jobs', async () => {
  const { scheduleImmediateJob } = setup(() => Date.UTC(2026, 9, 24))
  const error = new Error('database unavailable')
  vi.mocked(deleteExpiredGameSessionEvidence).mockRejectedValueOnce(error)
  const [changes, evidence, periodic] = scheduleImmediateJob.mock.calls.map(
    call => call[2] as () => Promise<void>,
  )
  await expect(evidence()).rejects.toBe(error)
  await Promise.all([changes(), periodic()])
  expect(deleteExpiredGameSessionPeriodicEvidence).toHaveBeenCalledTimes(1)
})
