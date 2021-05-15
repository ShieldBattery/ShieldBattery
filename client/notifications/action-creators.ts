import { MarkNotificationsReadServerBody, Notification } from '../../common/notifications'
import { ThunkAction } from '../dispatch-registry'
import fetch from '../network/fetch'
import { apiUrl } from '../network/urls'
import { openSnackbar } from '../snackbars/action-creators'
import { AddNotification, MarkNotificationsReadBegin } from './actions'

export function clearNotifications(): ThunkAction {
  return (dispatch, getState) => {
    const { idToNotification, notificationIds } = getState().notifications

    dispatch({
      type: '@notifications/clearBegin',
      payload: { idToNotification, notificationIds },
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
      meta: { idToNotification, notificationIds },
    })
  }
}

export function addNotification(notification: Readonly<Notification>): AddNotification {
  return {
    type: '@notifications/add',
    payload: { notification },
  }
}

export function markLocalNotificationsRead(notificationIds: string[]): MarkNotificationsReadBegin {
  return {
    type: '@notifications/markReadBegin',
    payload: { notificationIds },
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
