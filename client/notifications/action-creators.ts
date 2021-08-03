import cuid from 'cuid'
import {
  ClearNotificationsServerBody,
  ClearNotificationsServerPayload,
  MarkNotificationsReadServerBody,
  Notification,
} from '../../common/notifications'
import { ThunkAction } from '../dispatch-registry'
import fetch from '../network/fetch'
import { apiUrl } from '../network/urls'
import { openSnackbar } from '../snackbars/action-creators'
import { AddNotification, ClearNotificationById, MarkNotificationsRead } from './actions'
import { NotificationRecordBase } from './notification-reducer'

export function clearNotifications(): ThunkAction {
  return (dispatch, getState) => {
    const { idToNotification, notificationIds } = getState().notifications
    const newestServerId = notificationIds.findLast(id => {
      const notification = idToNotification.get(id) as NotificationRecordBase
      return notification && !notification.local
    })

    const timestamp = newestServerId ? idToNotification.get(newestServerId)?.createdAt : undefined
    const reqId = cuid()

    dispatch({
      type: '@notifications/clearBegin',
      payload: { reqId, timestamp },
    })

    const requestBody: ClearNotificationsServerBody = { timestamp }
    dispatch({
      type: '@notifications/clear',
      payload: fetch<ClearNotificationsServerPayload>(apiUrl`notifications/clear`, {
        method: 'post',
        body: JSON.stringify(requestBody),
      }).catch(err => {
        dispatch(
          openSnackbar({
            message: 'An error occurred while clearing notifications',
          }),
        )
        throw err
      }),
      meta: { reqId },
    })
  }
}

export function addNotification(notification: Readonly<Notification>): AddNotification {
  return {
    type: '@notifications/add',
    payload: { notification },
  }
}

export function clearNotificationById(id: string): ClearNotificationById {
  return {
    type: '@notifications/clearById',
    payload: { notificationId: id },
  }
}

export function markLocalNotificationsRead(notificationIds: string[]): MarkNotificationsRead {
  return {
    type: '@notifications/markRead',
    meta: { notificationIds },
  }
}

export function markNotificationsRead(notificationIds: string[]): ThunkAction {
  return dispatch => {
    dispatch({
      type: '@notifications/markReadBegin',
      payload: { notificationIds },
    })

    const requestBody: MarkNotificationsReadServerBody = { notificationIds }
    dispatch({
      type: '@notifications/markRead',
      payload: fetch<void>(apiUrl`notifications/read`, {
        method: 'post',
        body: JSON.stringify(requestBody),
      }).catch(err => {
        dispatch(
          openSnackbar({
            message: 'An error occurred while marking a notification read',
          }),
        )
        throw err
      }),
      meta: { notificationIds },
    })
  }
}
