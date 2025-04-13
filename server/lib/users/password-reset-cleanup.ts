import { singleton } from 'tsyringe'
import { JobScheduler } from '../jobs/job-scheduler'
import logger from '../logging/logger'
import { exhaustOldPasswordResetCodes } from './password-reset-model'

const JOB_RUN_INTERVAL_MS = 1000 * 60 * 60 * 3 // 3 hours

/**
 * Job that periodically cleans up old password reset codes.
 */
@singleton()
export class PasswordResetCleanupJob {
  constructor(private jobScheduler: JobScheduler) {
    this.jobScheduler.scheduleImmediateJob(
      'lib/users#passwordResetCleanup',
      JOB_RUN_INTERVAL_MS,
      async () => {
        const count = await exhaustOldPasswordResetCodes()
        if (count > 0) {
          logger.info(`Exhausted ${count} old password reset codes`)
        }
      },
    )
  }
}
