import { Notification } from '../../common/notifications'
import { AddNotification, ClearNotifications, MarkNotificationsRead } from './actions'

export function clearNotifications(): ClearNotifications {
  return {
    type: '@notifications/clear',
  }
}

export function addNotification(notification: Readonly<Notification>): AddNotification {
  return {
    type: '@notifications/add',
    payload: { notification },
  }
}

export function markNotificationsRead(): MarkNotificationsRead {
  return {
    type: '@notifications/markRead',
  }
}
