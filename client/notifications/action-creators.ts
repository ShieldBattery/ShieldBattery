import cuid from 'cuid'
import {
  ClearNotificationsServerRequest,
  ClearNotificationsServerResponse,
  MarkNotificationsReadServerRequest,
  SbNotification,
} from '../../common/notifications.js'
import { apiUrl } from '../../common/urls.js'
import { ThunkAction } from '../dispatch-registry.js'
import i18n from '../i18n/i18next.js'
import { fetchJson } from '../network/fetch.js'
import { openSnackbar } from '../snackbars/action-creators.js'
import { AddNotification, ClearNotificationById, MarkNotificationsRead } from './actions.js'

export function clearNotifications(): ThunkAction {
  return (dispatch, getState) => {
    const { byId, orderedIds } = getState().notifications
    const newestServerId = orderedIds.find(id => {
      const notification = byId.get(id)
      return notification && !notification.local
    })

    const timestamp = newestServerId ? byId.get(newestServerId)?.createdAt : undefined
    const reqId = cuid()

    dispatch({
      type: '@notifications/clearBegin',
      payload: { reqId, timestamp },
    })

    const requestBody: ClearNotificationsServerRequest = { timestamp }
    dispatch({
      type: '@notifications/clear',
      payload: fetchJson<ClearNotificationsServerResponse>(apiUrl`notifications/clear`, {
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

export function addNotification(notification: Readonly<SbNotification>): AddNotification {
  return {
    type: '@notifications/add',
    payload: { notification },
  }
}

export function addLocalNotification<T extends SbNotification>(
  notification: Readonly<Omit<T, 'local' | 'read' | 'createdAt'>>,
): AddNotification {
  return addNotification({
    ...notification,
    local: true,
    read: false,
    createdAt: Date.now(),
    // NOTE(tec27): Not quite sure why this cast is necessary, this should be a verifiably complete
    // type. Readonly may be messing with it?
  } as unknown as T)
}

export function clearNotificationById(id: string): ClearNotificationById {
  return {
    type: '@notifications/clearById',
    payload: { notificationId: id },
  }
}

export function markLocalNotificationsRead(
  notificationIds: ReadonlyArray<string>,
): MarkNotificationsRead {
  return {
    type: '@notifications/markRead',
    meta: { notificationIds },
  }
}

export function markNotificationsRead(notificationIds: ReadonlyArray<string>): ThunkAction {
  return dispatch => {
    dispatch({
      type: '@notifications/markReadBegin',
      payload: { notificationIds },
    })

    const requestBody: MarkNotificationsReadServerRequest = { notificationIds }
    dispatch({
      type: '@notifications/markRead',
      payload: fetchJson<void>(apiUrl`notifications/read`, {
        method: 'post',
        body: JSON.stringify(requestBody),
      }).catch(err => {
        dispatch(
          openSnackbar({
            message: i18n.t(
              'notifications.errors.markRead',
              'An error occurred while marking a notification read',
            ),
          }),
        )
        throw err
      }),
      meta: { notificationIds },
    })
  }
}
