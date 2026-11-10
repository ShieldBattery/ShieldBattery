import { singleton } from 'tsyringe'
import { JobScheduler } from '../jobs/job-scheduler'
import { deleteExpiredGameSessionEvidence } from '../models/game-session-evidence'
import { deleteExpiredGameSessionEvidenceChanges } from '../models/game-session-evidence-changes'
import { deleteExpiredGameSessionPeriodicEvidence } from '../models/game-session-periodic-evidence'
import { Clock } from '../time/clock'

const CHANGES_RETENTION_MS = 30 * 24 * 60 * 60 * 1000
const INGESTION_RETENTION_MS = 7 * 24 * 60 * 60 * 1000
const CLEANUP_INTERVAL_MS = 60 * 1000

/**
 * Expires stored observations on two schedules.
 *
 * The change feed is the durable copy that consumers read, so it is kept long enough for a
 * consumer to recover from an extended outage. The ingestion tables only need to outlive repeated
 * or late deliveries of the same observation, which they use to ignore duplicates and refuse
 * conflicting ones, and the recent-coverage reads; those stop within hours of a game. Deleting an
 * ingestion row does not touch the feed's copy.
 *
 * Each table is expired by its own job so that a failure deleting from one cannot skip the others.
 */
@singleton()
export class EvidenceRetentionService {
  constructor(jobScheduler: JobScheduler, clock: Clock) {
    jobScheduler.scheduleImmediateJob(
      'lib/netcode-v2#expireEvidenceChanges',
      CLEANUP_INTERVAL_MS,
      () => deleteExpiredGameSessionEvidenceChanges(new Date(clock.now() - CHANGES_RETENTION_MS)),
    )
    jobScheduler.scheduleImmediateJob(
      'lib/netcode-v2#expireIngestedEvidence',
      CLEANUP_INTERVAL_MS,
      () => deleteExpiredGameSessionEvidence(new Date(clock.now() - INGESTION_RETENTION_MS)),
    )
    jobScheduler.scheduleImmediateJob(
      'lib/netcode-v2#expireIngestedPeriodicEvidence',
      CLEANUP_INTERVAL_MS,
      () =>
        deleteExpiredGameSessionPeriodicEvidence(new Date(clock.now() - INGESTION_RETENTION_MS)),
    )
  }
}
