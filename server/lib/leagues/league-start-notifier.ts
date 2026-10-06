import { singleton } from 'tsyringe'
import { LeagueId } from '../../../common/leagues/leagues'
import { NotificationType } from '../../../common/notifications'
import { JobScheduler } from '../jobs/job-scheduler'
import logger from '../logging/logger'
import NotificationService from '../notifications/notification-service'
import { Clock } from '../time/clock'
import {
  claimLeagueStartNotification,
  getLeaguesPendingStartNotification,
  getUnbannedLeagueUserIds,
  releaseLeagueStartNotificationClaim,
} from './league-models'

const RETRY_DELAY_MS = 60 * 1000

function jobIdForLeague(leagueId: LeagueId) {
  return `lib/leagues#leagueStartNotification/${leagueId}`
}

/**
 * Notifies the members of a league when the league starts. A one-off job is scheduled at each
 * league's start time; whether a league has been handled is tracked in the database, so a league
 * is notified at most once regardless of restarts or how many server processes schedule it.
 */
@singleton()
export class LeagueStartNotifier {
  constructor(
    private jobScheduler: JobScheduler,
    private clock: Clock,
    private notificationService: NotificationService,
  ) {
    getLeaguesPendingStartNotification().then(
      leagues => {
        for (const league of leagues) {
          this.scheduleLeague(league.id, league.startAt)
        }
      },
      err => {
        logger.error({ err }, 'Error loading leagues pending start notifications')
      },
    )
  }

  /**
   * Schedules the start notifications for a league, replacing any previously scheduled for it.
   * Should be called whenever a league is created or its start time changes.
   */
  scheduleLeague(leagueId: LeagueId, startAt: Date) {
    this.jobScheduler.scheduleJob(
      jobIdForLeague(leagueId),
      new Date(Math.max(Number(startAt), this.clock.now())),
      -1,
      async () => await this.notifyLeague(leagueId),
    )
  }

  async notifyLeague(leagueId: LeagueId): Promise<void> {
    const now = new Date(this.clock.now())
    // Returns nothing if another process already handled the league, or if its start time was
    // moved later (in which case the league has been rescheduled for the new time).
    const league = await claimLeagueStartNotification(leagueId, now)
    if (!league || league.endAt <= now) {
      // A league that has already ended (e.g. the server was down for its whole run) is left
      // claimed without notifying, since a "league started" notification would only be misleading.
      return
    }

    try {
      const userIds = await getUnbannedLeagueUserIds(leagueId)
      await this.notificationService.addNotificationForUsers({
        userIds,
        data: { type: NotificationType.LeagueStart, leagueName: league.name },
      })
      logger.info(`Sent league start notifications for ${leagueId} to ${userIds.length} users`)
    } catch (err) {
      logger.error({ err }, `Error sending league start notifications for ${leagueId}`)
      // The notifications are inserted in a single statement, so a failure means none of them
      // were stored and the league can be retried without duplicating any.
      try {
        await releaseLeagueStartNotificationClaim(leagueId)
        this.scheduleLeague(leagueId, new Date(this.clock.now() + RETRY_DELAY_MS))
      } catch (err) {
        logger.error({ err }, `Error releasing league start notification claim for ${leagueId}`)
      }
    }
  }
}
