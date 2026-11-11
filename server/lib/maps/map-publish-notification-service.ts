import { singleton } from 'tsyringe'
import { NotificationType } from '../../../common/notifications'
import logger from '../logging/logger'
import NotificationService from '../notifications/notification-service'
import { RedisSubscriber } from '../redis/redis'

/**
 * Listens for map publishing events published by the Rust server (server-rs owns map publishing,
 * but the notification machinery lives here) and tells the publisher about staff actions on their
 * files.
 *
 * This has no HTTP API of its own, so it's eagerly constructed in `routes.ts` to make sure the
 * Redis subscription is set up at boot.
 */
@singleton()
export class MapPublishNotificationService {
  constructor(
    private redisSubscriber: RedisSubscriber,
    private notificationService: NotificationService,
  ) {
    this.redisSubscriber
      .subscribe('mapPublish', message => {
        switch (message.type) {
          case 'fileDelisted':
            this.notificationService
              .addNotification({
                userId: message.data.publisherId,
                data: {
                  type: NotificationType.MapFileDelisted,
                  mapId: message.data.fileId,
                  familyId: message.data.familyId,
                  mapName: message.data.name,
                  note: message.data.note,
                },
              })
              .catch(err => {
                logger.error({ err }, 'failed to create map file delisted notification')
              })
            break
          case 'heldPublishListed':
            this.notificationService
              .addNotification({
                userId: message.data.publisherId,
                data: {
                  type: NotificationType.MapPublishApproved,
                  mapId: message.data.fileId,
                  familyId: message.data.familyId,
                  mapName: message.data.name,
                },
              })
              .catch(err => {
                logger.error({ err }, 'failed to create map publish approved notification')
              })
            break
          default:
            message satisfies never
            logger.warn(`received an unknown mapPublish message type: ${(message as any).type}`)
        }
      })
      .catch(err => {
        logger.error({ err }, 'failed to subscribe to Redis mapPublish messages')
      })
  }
}
