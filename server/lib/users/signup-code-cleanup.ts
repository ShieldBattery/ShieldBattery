import { singleton } from 'tsyringe'
import db from '../db'
import { JobScheduler } from '../jobs/job-scheduler'
import logger from '../logging/logger'

const JOB_RUN_INTERVAL_MS = 1000 * 60 * 60 * 24 // 24 hours

/**
 * Job that periodically cleans up expired signup codes by marking them as exhausted.
 */
@singleton()
export class SignupCodeCleanupJob {
  constructor(private jobScheduler: JobScheduler) {
    this.jobScheduler.scheduleImmediateJob(
      'lib/users#signupCodeCleanup',
      JOB_RUN_INTERVAL_MS,
      async () => {
        const { client, done } = await db()
        try {
          const result = await client.query(
            'UPDATE user_signup_codes SET exhausted = true WHERE expires_at < NOW() AND NOT exhausted',
          )
          const count = result.rowCount ?? 0
          if (count > 0) {
            logger.info(`Exhausted ${count} expired signup codes`)
          }
        } finally {
          done()
        }
      },
    )
  }
}
