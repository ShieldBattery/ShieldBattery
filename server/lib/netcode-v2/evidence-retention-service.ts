import { singleton } from 'tsyringe'
import { JobScheduler } from '../jobs/job-scheduler'
import { deleteExpiredGameSessionEvidenceChanges } from '../models/game-session-evidence-changes'
import { Clock } from '../time/clock'

const RETENTION_MS = 90 * 24 * 60 * 60 * 1000
const CLEANUP_INTERVAL_MS = 60 * 1000

/** Keeps durable observations available for consumers recovering from an extended outage. */
@singleton()
export class EvidenceRetentionService {
  constructor(jobScheduler: JobScheduler, clock: Clock) {
    jobScheduler.scheduleImmediateJob(
      'lib/netcode-v2#expireEvidenceChanges',
      CLEANUP_INTERVAL_MS,
      () => deleteExpiredGameSessionEvidenceChanges(new Date(clock.now() - RETENTION_MS)),
    )
  }
}
