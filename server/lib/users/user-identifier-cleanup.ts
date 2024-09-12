import { singleton } from 'tsyringe'
import { JobScheduler } from '../jobs/job-scheduler.js'
import logger from '../logging/logger.js'
import { Clock } from '../time/clock.js'
import { cleanupUnbannedIdentifiers } from './user-identifiers.js'

const OLD_IDENTIFIER_TIME_MILLIS = 1000 * 60 * 60 * 24 * 30 * 3 // 3 months
const JOB_RUN_INTERVAL_MINUTES = 60 * 3 // 3 hours

/**
 * Job that periodically cleans up old user identifiers that haven't been used recently, provided
 * they were not the subject of a ban.
 */
@singleton()
export class UserIdentifierCleanupJob {
  constructor(
    private jobScheduler: JobScheduler,
    private clock: Clock,
  ) {
    const startTime = new Date(this.clock.now())
    startTime.setMinutes(startTime.getMinutes() + JOB_RUN_INTERVAL_MINUTES)

    this.jobScheduler.scheduleJob(
      'lib/users#userIdentifierCleanup',
      startTime,
      JOB_RUN_INTERVAL_MINUTES * 60 * 1000,
      async () => {
        const removeBefore = new Date(this.clock.now() - OLD_IDENTIFIER_TIME_MILLIS)
        const count = await cleanupUnbannedIdentifiers(removeBefore)
        if (count > 0) {
          logger.info(`Cleaned up ${count} old user identifiers`)
        }
      },
    )
  }
}
