import { afterEach, expect, test, vi } from 'vitest'
import { JobScheduler } from '../jobs/job-scheduler'
import { Clock } from '../time/clock'
import { cleanupOldRestrictedIdentifiers } from './restriction-models'
import { UserIdentifierCleanupJob } from './user-identifier-cleanup'
import { cleanupOldBannedIdentifiers, cleanupUnpunishedIdentifiers } from './user-identifiers'

vi.mock('./restriction-models', () => ({
  cleanupOldRestrictedIdentifiers: vi.fn(async () => 0),
}))

vi.mock('./user-identifiers', () => ({
  cleanupOldBannedIdentifiers: vi.fn(async () => 0),
  cleanupUnpunishedIdentifiers: vi.fn(async () => 0),
}))

afterEach(() => vi.clearAllMocks())

const NOW = Date.UTC(2026, 10, 20)
const DAY_MILLIS = 24 * 60 * 60 * 1000

async function runCleanupJob() {
  const scheduleImmediateJob = vi.fn()
  const job = new UserIdentifierCleanupJob(
    { scheduleImmediateJob } as unknown as JobScheduler,
    { now: () => NOW } as Clock,
  )
  expect(job).toBeInstanceOf(UserIdentifierCleanupJob)
  const run = scheduleImmediateJob.mock.calls[0][2] as () => Promise<void>
  await run()
}

test('keeps identifier bans for 183 days after they expire', async () => {
  await runCleanupJob()
  expect(cleanupOldBannedIdentifiers).toHaveBeenCalledWith(new Date(NOW - 183 * DAY_MILLIS))
})

test('keeps restricted and unpunished identifiers for 90 days', async () => {
  await runCleanupJob()
  expect(cleanupOldRestrictedIdentifiers).toHaveBeenCalledWith(new Date(NOW - 90 * DAY_MILLIS))
  expect(cleanupUnpunishedIdentifiers).toHaveBeenCalledWith(new Date(NOW - 90 * DAY_MILLIS))
})
