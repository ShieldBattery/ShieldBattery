import { singleton } from 'tsyringe'
import { NotificationType } from '../../../common/notifications'
import { JobScheduler } from '../jobs/job-scheduler'
import logger from '../logging/logger'
import NotificationService from '../notifications/notification-service'
import { Clock } from '../time/clock'
import {
  claimStartedLeaguesForNotification,
  getUnbannedLeagueUserIds,
  releaseLeagueStartNotificationClaim,
} from './league-models'

const JOB_RUN_INTERVAL_MS = 60 * 1000

/**
 * Job that notifies the members of a league once the league has started. Which leagues have been
 * handled is tracked in the database, so a league is notified at most once regardless of restarts
 * or how many server processes run this job.
 */
@singleton()
export class LeagueStartNotificationJob {
  constructor(
    jobScheduler: JobScheduler,
    private clock: Clock,
    private notificationService: NotificationService,
  ) {
    jobScheduler.scheduleImmediateJob(
      'lib/leagues#leagueStartNotifications',
      JOB_RUN_INTERVAL_MS,
      async () => await this.notifyStartedLeagues(),
    )
  }

  async notifyStartedLeagues(): Promise<void> {
    const now = new Date(this.clock.now())
    const leagues = await claimStartedLeaguesForNotification(now)

    for (const league of leagues) {
      if (league.endAt <= now) {
        // Already over (e.g. the server was down for the league's whole run), so a "league
        // started" notification would only be misleading.
        continue
      }

      try {
        const userIds = await getUnbannedLeagueUserIds(league.id)
        await this.notificationService.addNotificationForUsers({
          userIds,
          data: { type: NotificationType.LeagueStart, leagueName: league.name },
        })
        logger.info(`Sent league start notifications for ${league.id} to ${userIds.length} users`)
      } catch (err) {
        logger.error({ err }, `Error sending league start notifications for ${league.id}`)
        // The notifications are inserted in a single statement, so a failure means none of them
        // were stored and the league can be retried on the next run without duplicating any.
        await releaseLeagueStartNotificationClaim(league.id).catch(err => {
          logger.error({ err }, `Error releasing league start notification claim for ${league.id}`)
        })
      }
    }
  }
}
