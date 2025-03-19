import { singleton } from 'tsyringe'
import { JobScheduler } from '../jobs/job-scheduler'
import logger from '../logging/logger'
import { Clock } from '../time/clock'
import { cleanupOldUserIps } from './user-ips'

const OLD_IP_TIME_MILLIS = 1000 * 60 * 60 * 24 * 365 // 1 year
const JOB_RUN_INTERVAL_MINUTES = 60 * 3 // 3 hours

/**
 * Job that periodically cleans up old user IP records that haven't been used in over a year.
 */
@singleton()
export class UserIpsCleanupJob {
  constructor(
    private jobScheduler: JobScheduler,
    private clock: Clock,
  ) {
    const startTime = new Date(this.clock.now())
    startTime.setMinutes(
      startTime.getMinutes() +
        JOB_RUN_INTERVAL_MINUTES -
        (Math.random() * JOB_RUN_INTERVAL_MINUTES) / 2,
    )
    this.jobScheduler.scheduleJob(
      'lib/users#userIpsCleanup',
      startTime,
      JOB_RUN_INTERVAL_MINUTES * 60 * 1000,
      async () => {
        const removeBefore = new Date(this.clock.now() - OLD_IP_TIME_MILLIS)
        const count = await cleanupOldUserIps(removeBefore)
        if (count > 0) {
          logger.info(`Cleaned up ${count} old user IPs`)
        }
      },
    )
  }
}
