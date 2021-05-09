import { MarkNotificationsReadServerBody, Notification } from '../../common/notifications'
import { ThunkAction } from '../dispatch-registry'
import fetch from '../network/fetch'
import { apiUrl } from '../network/urls'
import { openSnackbar } from '../snackbars/action-creators'
import { AddNotification, MarkLocalNotificationsRead } from './actions'

export function clearNotifications(): ThunkAction {
  return dispatch => {
    dispatch({
      type: '@notifications/clearBegin',
    })

    dispatch({
      type: '@notifications/clear',
      payload: fetch<void>(apiUrl`notifications/clear`, { method: 'post' }).catch(err => {
        dispatch(
          openSnackbar({
            message: 'An error occurred while clearing notifications',
          }),
        )
        throw err
      }),
    })
  }
}

export function addNotification(notification: Readonly<Notification>): AddNotification {
  return {
    type: '@notifications/add',
    payload: { notification },
  }
}

export function markLocalNotificationsRead(notificationIds: string[]): MarkLocalNotificationsRead {
  return {
    type: '@notifications/markRead',
    payload: { notificationIds },
    meta: { notificationIds },
  }
}

export function markNotificationsRead(notificationIds: string[]): ThunkAction {
  return dispatch => {
    dispatch({
      type: '@notifications/markReadBegin',
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
