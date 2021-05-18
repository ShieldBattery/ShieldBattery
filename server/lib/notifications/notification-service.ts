import { NydusServer } from 'nydus'
import { singleton } from 'tsyringe'
import {
  NotificationAddEvent,
  NotificationClearByIdEvent,
  NotificationClearEvent,
  NotificationMarkReadEvent,
  NotificationServerInitEvent,
} from '../../../common/notifications'
import logger from '../logging/logger'
import { ClientSocketsManager } from '../websockets/socket-groups'
import {
  addNotification,
  clear,
  clearById,
  markRead,
  NotificationData,
  retrieveNotifications,
} from './notification-model'

export function getNotificationsPath(userId: number): string {
  return `/notifications/${userId}`
}

@singleton()
export default class NotificationService {
  constructor(private nydus: NydusServer, private clientSocketsManager: ClientSocketsManager) {
    this.clientSocketsManager.on('newClient', c => {
      c.subscribe(getNotificationsPath(c.userId), async () => {
        try {
          const notifications = await retrieveNotifications({ userId: c.userId })
          const serverInitEventData: NotificationServerInitEvent = {
            type: 'serverInit',
            notifications: notifications.map(n => ({
              id: n.id,
              read: n.read,
              createdAt: Number(n.createdAt),
              ...n.data,
            })),
          }

          return serverInitEventData
        } catch (err) {
          logger.error({ err }, 'error retrieving user notifications')
          return undefined
        }
      })
    })
  }

  /**
   * Creates a new notification for a particular user with the provided data to the DB and notifies
   * all of user's connected clients.
   */
  async addNotification(notificationProps: {
    userId: number
    data: NotificationData
    createdAt?: Date
  }) {
    const notification = await addNotification(notificationProps)

    const addEventData: NotificationAddEvent = {
      type: 'add',
      notification: {
        id: notification.id,
        read: notification.read,
        createdAt: Number(notification.createdAt),
        ...notification.data,
      },
    }
    this.nydus.publish(getNotificationsPath(notificationProps.userId), addEventData)
  }

  /**
   * Clears, i.e. makes not visible, all notifications before a given timestamp for a particular
   * user and notifies all of user's connected clients.
   */
  async clear(userId: number, timestamp: number) {
    await clear(userId, timestamp)

    const clearEventData: NotificationClearEvent = {
      type: 'clear',
      timestamp,
    }
    this.nydus.publish(getNotificationsPath(userId), clearEventData)
  }

  /**
   * Clears, i.e. makes not visible, a specific notification for a particular user and notifies all
   * of user's connected clients.
   */
  async clearById(userId: number, notificationId: string) {
    await clearById(userId, notificationId)

    const clearByIdEventData: NotificationClearByIdEvent = {
      type: 'clearById',
      notificationId,
    }
    this.nydus.publish(getNotificationsPath(userId), clearByIdEventData)
  }

  /**
   * Markes all of the given notifications as "read" for a particular user and notifies all of
   * user's connected clients.
   */
  async markRead(userId: number, notificationIds: string[]) {
    await markRead(userId, notificationIds)

    const markReadEventData: NotificationMarkReadEvent = {
      type: 'markRead',
      notificationIds,
    }
    this.nydus.publish(getNotificationsPath(userId), markReadEventData)
  }
}
