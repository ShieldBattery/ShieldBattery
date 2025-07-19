import { singleton } from 'tsyringe'
import { JobScheduler } from '../jobs/job-scheduler'
import logger from '../logging/logger'
import { Clock } from '../time/clock'
import { cleanupOldBannedIdentifiers, cleanupUnbannedIdentifiers } from './user-identifiers'

const OLD_BAN_TIME_MILLIS = 1000 * 60 * 60 * 24 * 30 // 6 months
const OLD_IDENTIFIER_TIME_MILLIS = 1000 * 60 * 60 * 24 * 30 * 3 // 3 months
const JOB_RUN_INTERVAL_MILLIS = 3 * 60 * 60 * 1000 // 3 hours

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
    this.jobScheduler.scheduleImmediateJob(
      'lib/users#userIdentifierCleanup',
      JOB_RUN_INTERVAL_MILLIS,
      async () => {
        const removeBansBefore = new Date(this.clock.now() - OLD_BAN_TIME_MILLIS)
        const banCount = await cleanupOldBannedIdentifiers(removeBansBefore)
        if (banCount > 0) {
          logger.info(`Cleaned up ${banCount} old user identifier bans`)
        }

        const removeBefore = new Date(this.clock.now() - OLD_IDENTIFIER_TIME_MILLIS)
        const count = await cleanupUnbannedIdentifiers(removeBefore)
        if (count > 0) {
          logger.info(`Cleaned up ${count} old user identifiers`)
        }
      },
    )
  }
}
