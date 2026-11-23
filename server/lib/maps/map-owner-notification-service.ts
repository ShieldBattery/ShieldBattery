import { singleton } from 'tsyringe'
import { MapOwnerNotificationEvent, NotificationType } from '../../../common/notifications'
import { SbUserId } from '../../../common/users/sb-user-id'
import logger from '../logging/logger'
import NotificationService from '../notifications/notification-service'
import { RedisSubscriber } from '../redis/redis'

/**
 * Listens for map ownership events published by the Rust server (server-rs owns map ownership, but
 * the notification machinery lives here) and tells the user each one concerns.
 *
 * This has no HTTP API of its own, so it's eagerly constructed in `routes.ts` to make sure the
 * Redis subscription is set up at boot.
 */
@singleton()
export class MapOwnerNotificationService {
  constructor(
    private redisSubscriber: RedisSubscriber,
    private notificationService: NotificationService,
  ) {
    this.redisSubscriber
      .subscribe('mapOwner', message => {
        let userId: SbUserId
        let event: MapOwnerNotificationEvent
        switch (message.type) {
          case 'claimGranted':
            userId = message.data.claimantId
            event = { kind: 'claimGranted' }
            break
          case 'claimRejected':
            userId = message.data.claimantId
            event = { kind: 'claimRejected' }
            break
          case 'ownerSet':
            userId = message.data.ownerId
            event = { kind: 'ownerSet' }
            break
          case 'ownershipRemoved':
            userId = message.data.ownerId
            event = { kind: 'ownershipRemoved' }
            break
          case 'fileAdded':
            userId = message.data.ownerId
            event = {
              kind: 'fileAdded',
              actorId: message.data.actorId,
              fileId: message.data.fileId,
              fileName: message.data.fileName,
            }
            break
          case 'fileRemoved':
            userId = message.data.ownerId
            event = {
              kind: 'fileRemoved',
              actorId: message.data.actorId,
              fileId: message.data.fileId,
              fileName: message.data.fileName,
            }
            break
          default:
            message satisfies never
            logger.warn(`received an unknown mapOwner message type: ${(message as any).type}`)
            return
        }

        this.notificationService
          .addNotification({
            userId,
            data: {
              type: NotificationType.MapOwner,
              familyId: message.data.familyId,
              mapName: message.data.name,
              event,
            },
          })
          .catch(err => {
            logger.error({ err }, 'failed to create map owner notification')
          })
      })
      .catch(err => {
        logger.error({ err }, 'failed to subscribe to Redis mapOwner messages')
      })
  }
}
