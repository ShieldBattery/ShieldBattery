import { singleton } from 'tsyringe'
import { NotificationType } from '../../../common/notifications'
import logger from '../logging/logger'
import NotificationService from '../notifications/notification-service'
import { RedisSubscriber } from '../redis/redis'

/**
 * Listens for game-report events published by the Rust server (server-rs owns the reporting feature,
 * but the notification machinery lives here) and turns them into user-facing notifications.
 *
 * This has no HTTP API of its own, so it's eagerly constructed in `routes.ts` (like `NewsService`)
 * to make sure the Redis subscription is set up at boot.
 */
@singleton()
export class GameReportNotificationService {
  constructor(
    private redisSubscriber: RedisSubscriber,
    private notificationService: NotificationService,
  ) {
    this.redisSubscriber
      .subscribe('gameReport', message => {
        switch (message.type) {
          case 'reportActioned':
            // The notification is intentionally content-free (no player, game, or punishment
            // details) as an anti-retaliation measure; the interesting decision — who to notify —
            // was already made in server-rs.
            Promise.all(
              message.data.reporterIds.map(userId =>
                this.notificationService.addNotification({
                  userId,
                  data: { type: NotificationType.GameReportActioned },
                }),
              ),
            ).catch(err => {
              logger.error({ err }, 'failed to create game report actioned notifications')
            })
            break
          default:
            message.type satisfies never
            logger.warn(`received an unknown gameReport message type: ${(message as any).type}`)
        }
      })
      .catch(err => {
        logger.error({ err }, 'failed to subscribe to Redis gameReport messages')
      })
  }
}
