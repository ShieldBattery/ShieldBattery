import { singleton } from 'tsyringe'
import { nextWeekStartAfter } from '../../../common/map-feature-weeks'
import { NotificationType } from '../../../common/notifications'
import { JobScheduler } from '../jobs/job-scheduler'
import logger from '../logging/logger'
import NotificationService from '../notifications/notification-service'
import { RedisSubscriber } from '../redis/redis'
import { Clock } from '../time/clock'
import {
  ClaimedMapFeature,
  claimMapFeatureNotification,
  releaseMapFeatureNotificationClaim,
} from './map-feature-models'

const RETRY_DELAY_MS = 60 * 1000

const WEEK_START_JOB_ID = 'lib/maps#mapFeatureNotification/weekStart'
const RETRY_JOB_ID = 'lib/maps#mapFeatureNotification/retry'

/**
 * Tells the maker of the weekly staff pick (server-rs owns the picks, but the notification
 * machinery lives here) that their map or collection is the map or collection of the week, once,
 * while that week runs. It looks for a pick to announce at boot, when each week starts (a one-off
 * job at the next Monday 00:00 UTC, rescheduled every time it runs), and when server-rs says the
 * running week's pick changed. Whether a pick has been announced is tracked in the database, so a
 * pick is announced at most once regardless of restarts or how many server processes look.
 *
 * This has no HTTP API of its own, so it's eagerly constructed in `routes.ts` to make sure it's
 * running from boot.
 */
@singleton()
export class MapFeatureNotifier {
  constructor(
    private jobScheduler: JobScheduler,
    private clock: Clock,
    private notificationService: NotificationService,
    private redisSubscriber: RedisSubscriber,
  ) {
    // Covers a week that started while the server was down
    this.startNotifyCurrentPick()
    this.scheduleNextWeekStart()

    this.redisSubscriber
      .subscribe('mapFeature', message => {
        switch (message.type) {
          case 'pickChanged':
            this.startNotifyCurrentPick()
            break
          default:
            message.type satisfies never
            logger.warn(`received an unknown mapFeature message type: ${(message as any).type}`)
        }
      })
      .catch(err => {
        logger.error({ err }, 'failed to subscribe to Redis mapFeature messages')
      })
  }

  private startNotifyCurrentPick() {
    this.notifyCurrentPick().catch(err => {
      logger.error({ err }, 'Error notifying the map feature pick')
    })
  }

  private scheduleNextWeekStart() {
    this.jobScheduler.scheduleJob(
      WEEK_START_JOB_ID,
      nextWeekStartAfter(this.clock.now()),
      -1,
      async () => {
        this.scheduleNextWeekStart()
        await this.notifyCurrentPick()
      },
    )
  }

  private scheduleRetry() {
    this.jobScheduler.scheduleJob(
      RETRY_JOB_ID,
      new Date(this.clock.now() + RETRY_DELAY_MS),
      -1,
      async () => await this.notifyCurrentPick(),
    )
  }

  /**
   * Tells the maker of the running week's pick about it, unless that pick was already handled.
   * Never throws: failures are logged, and retried when a later attempt could succeed.
   */
  async notifyCurrentPick(): Promise<void> {
    const now = new Date(this.clock.now())
    let claimed: ClaimedMapFeature | undefined
    try {
      claimed = await claimMapFeatureNotification(now)
    } catch (err) {
      logger.error({ err }, 'Error claiming the map feature notification')
      this.scheduleRetry()
      return
    }
    if (!claimed?.userId) {
      // Either nothing to announce, or a pick with nobody to tell, which stays claimed
      return
    }

    try {
      await this.notificationService.addNotification({
        userId: claimed.userId,
        data: { type: NotificationType.MapFeatured, pick: claimed.pick },
      })
      logger.info(
        `Sent the map feature notification for the week of ${claimed.week.toISOString()} to ` +
          `user ${claimed.userId}`,
      )
    } catch (err) {
      logger.error({ err }, 'Error sending the map feature notification')
      // The notification is a single insert, so a failure means it wasn't stored and the pick can
      // be retried without duplicating it.
      try {
        await releaseMapFeatureNotificationClaim(claimed.week, now)
        this.scheduleRetry()
      } catch (err) {
        logger.error({ err }, 'Error releasing the map feature notification claim')
      }
    }
  }
}
