import { singleton } from 'tsyringe'
import { NotificationEvent, NotificationServerInitEvent } from '../../../common/notifications'
import { SbUserId } from '../../../common/users/sb-user'
import logger from '../logging/logger'
import { ClientSocketsManager } from '../websockets/socket-groups'
import { TypedPublisher } from '../websockets/typed-publisher'
import {
  addNotification,
  clearBefore,
  clearById,
  markRead,
  NotificationData,
  retrieveNotifications,
  SearchNotificationData,
} from './notification-model'

export function getNotificationsPath(userId: SbUserId): string {
  return `/notifications/${userId}`
}

@singleton()
export default class NotificationService {
  constructor(
    private publisher: TypedPublisher<NotificationEvent>,
    private clientSocketsManager: ClientSocketsManager,
  ) {
    this.clientSocketsManager.on('newClient', c => {
      c.subscribe<NotificationServerInitEvent | undefined>(
        getNotificationsPath(c.userId),
        async () => {
          try {
            const notifications = await retrieveNotifications({ userId: c.userId })

            return {
              type: 'serverInit',
              notifications: notifications.map(n => ({
                id: n.id,
                read: n.read,
                createdAt: Number(n.createdAt),
                ...n.data,
              })),
            }
          } catch (err) {
            logger.error({ err }, 'error retrieving user notifications')
            return undefined
          }
        },
      )
    })
  }

  /**
   * Service method to retrieve user notifications. Should be used by other services instead of
   * calling the DB method directly.
   */
  retrieveNotifications(props: {
    userId: SbUserId
    data?: SearchNotificationData
    visible?: boolean
    limit?: number
  }) {
    return retrieveNotifications(props)
  }

  /**
   * Creates a new notification for a particular user, saves it to the database, and notifies all of
   * the user's connected clients.
   */
  async addNotification(notificationProps: {
    userId: SbUserId
    data: NotificationData
    createdAt?: Date
  }) {
    const notification = await addNotification(notificationProps)

    this.publisher.publish(getNotificationsPath(notificationProps.userId), {
      type: 'add',
      notification: {
        id: notification.id,
        read: notification.read,
        createdAt: Number(notification.createdAt),
        ...notification.data,
      },
    })
  }

  /**
   * Clears all notifications before a given date for a particular user.
   */
  async clearBefore(userId: SbUserId, date: Date) {
    await clearBefore(userId, date)

    this.publisher.publish(getNotificationsPath(userId), {
      type: 'clear',
      timestamp: Number(date),
    })
  }

  /**
   * Clears, i.e. makes not visible, a specific notification for a particular user and notifies all
   * of user's connected clients.
   */
  async clearById(userId: SbUserId, notificationId: string) {
    await clearById(userId, notificationId)

    this.publisher.publish(getNotificationsPath(userId), {
      type: 'clearById',
      notificationId,
    })
  }

  /** Clears the first visible notification that matches the given criteria (if one exists). */
  async clearFirstMatching(criteria: { userId: SbUserId; data?: SearchNotificationData }) {
    // TODO(tec27): This could probably avoid a round-trip if we write a model method for this
    // directly
    const notification = (
      await this.retrieveNotifications({
        userId: criteria.userId,
        data: criteria.data,
        visible: true,
      })
    )[0]

    if (notification) {
      await this.clearById(criteria.userId, notification.id)
    }
  }

  /**
   * Marks all of the given notifications as "read" for a particular user and notifies all of user's
   * connected clients.
   */
  async markRead(userId: SbUserId, notificationIds: ReadonlyArray<string>) {
    await markRead(userId, notificationIds)

    this.publisher.publish(getNotificationsPath(userId), {
      type: 'markRead',
      notificationIds,
    })
  }
}
