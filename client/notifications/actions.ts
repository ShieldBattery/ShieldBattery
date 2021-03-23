import { Notification } from '../../common/notifications'

export type NotificationActions = AddNotification | ClearNotifications | MarkNotificationsRead

export interface AddNotification {
  type: '@notifications/add'
  payload: { notification: Readonly<Notification> }
}

export interface ClearNotifications {
  type: '@notifications/clear'
}

export interface MarkNotificationsRead {
  type: '@notifications/markRead'
}
