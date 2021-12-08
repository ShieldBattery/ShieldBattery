import { ClearNotificationsServerResponse, SbNotification } from '../../common/notifications'
import { BaseFetchFailure } from '../network/fetch-action-types'

export type NotificationActions =
  | ServerInitNotifications
  | AddNotification
  | ClearNotificationById
  | ClearNotificationsBegin
  | ClearNotifications
  | ClearNotificationsFailure
  | MarkNotificationsReadBegin
  | MarkNotificationsRead
  | MarkNotificationsReadFailure

/**
 * Action which initializes the client's list of notifications with all the visible, server-side
 * notifications they might have, merging them with all the existing, locally generated ones.
 * Usually done whenever a new client connects to the server.
 */
export interface ServerInitNotifications {
  type: '@notifications/serverInit'
  payload: { notifications: Readonly<SbNotification[]> }
}

/**
 * Adds a new notification to the top of the list of already existing ones.
 */
export interface AddNotification {
  type: '@notifications/add'
  payload: { notification: Readonly<SbNotification> }
}

/**
 * Clears a specific notification from the list of notifications, i.e. makes it not visible anymore.
 */
export interface ClearNotificationById {
  type: '@notifications/clearById'
  payload: { notificationId: Readonly<string> }
}

export interface ClearNotificationsBegin {
  type: '@notifications/clearBegin'
  payload: {
    reqId: string
    timestamp?: number
  }
}

/**
 * Clears notifications from the list of notifications, and in such a way that local notifications
 * are cleared unconditionally, while server notifications are cleared based on the timestamp
 * provided through payload.
 */
export interface ClearNotifications {
  type: '@notifications/clear'
  payload: ClearNotificationsServerResponse
  meta?: { reqId?: string }
  error?: false
}

export interface ClearNotificationsFailure extends BaseFetchFailure<'@notifications/clear'> {
  meta?: { reqId?: string }
}

export interface MarkNotificationsReadBegin {
  type: '@notifications/markReadBegin'
  payload: { notificationIds: ReadonlyArray<string> }
}

/**
 * Marks all the given notifications as read, both the ones generated locally and the ones generated
 * on the server.
 */
export interface MarkNotificationsRead {
  type: '@notifications/markRead'
  payload?: void
  meta: { notificationIds: ReadonlyArray<string> }
  error?: false
}

export interface MarkNotificationsReadFailure extends BaseFetchFailure<'@notifications/markRead'> {
  meta: { notificationIds: ReadonlyArray<string> }
}
