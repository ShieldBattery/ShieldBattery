import { NydusServer } from 'nydus'
import { singleton } from 'tsyringe'
import {
  NotificationAddEvent,
  NotificationClearByIdEvent,
  NotificationServerInitEvent,
} from '../../../common/notifications'
import { ClientSocketsManager } from '../websockets/socket-groups'
import {
  addNotification,
  clearById,
  NotificationData,
  retrieveNotifications,
} from './notification-model'

export function getNotificationsPath(userId: number): string {
  return `/notifications/${userId}`
}

@singleton()
export default class NotificationService {
  constructor(private nydus: NydusServer, private clientSocketsManager: ClientSocketsManager) {
    this.clientSocketsManager.on('newClient', async c => {
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
      c.subscribe(getNotificationsPath(c.userId), () => serverInitEventData)
    })
  }

  /**
   * Adds a new notification with the provided data to the DB, and notifies all clients to update
   * their local lists.
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

  async clearById(userId: number, notificationId: string) {
    await clearById(userId, notificationId)

    const clearByIdEventData: NotificationClearByIdEvent = {
      type: 'clearById',
      notificationId,
    }
    this.nydus.publish(getNotificationsPath(userId), clearByIdEventData)
  }
}
