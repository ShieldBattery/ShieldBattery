import { List, Map, Record } from 'immutable'
import { assertUnreachable } from '../../common/assert-unreachable'
import { EMAIL_VERIFICATION_ID, Notification, NotificationType } from '../../common/notifications'
import keyedReducer from '../reducers/keyed-reducer'

export interface NotificationRecordBase {
  id: string
  type: NotificationType
  read: boolean
  createdAt: number
  local?: boolean
}

export class EmailVerificationNotificationRecord
  extends Record({
    id: EMAIL_VERIFICATION_ID,
    type: NotificationType.EmailVerification as typeof NotificationType.EmailVerification,
    read: false,
    createdAt: 0,
    local: true,
  })
  implements NotificationRecordBase {}

export type NotificationRecord = EmailVerificationNotificationRecord

function toNotificationRecord(notification: Readonly<Notification>): NotificationRecord {
  switch (notification.type) {
    case NotificationType.EmailVerification:
      return new EmailVerificationNotificationRecord(notification)
    default:
      return assertUnreachable(notification.type)
  }
}

export class NotificationState extends Record({
  map: Map<string, NotificationRecord>(),
  ids: List<string>(),
}) {}

export default keyedReducer(new NotificationState(), {
  ['@notifications/serverInit'](state, { payload: { notifications } }) {
    return state
      .update('map', m => m.merge(notifications.map(n => [n.id, toNotificationRecord(n)])))
      .update('ids', s => s.unshift(...notifications.map(n => n.id)))
  },

  ['@notifications/add'](state, { payload: { notification } }) {
    if (state.map.has(notification.id)) {
      return state
    }

    return state
      .update('map', m => m.set(notification.id, toNotificationRecord(notification)))
      .update('ids', s => s.unshift(notification.id))
  },

  ['@notifications/clearById'](state, { payload: { notificationId } }) {
    const notificationIndex = state.ids.indexOf(notificationId)

    if (notificationIndex < 0) {
      return state
    }

    return state.deleteIn(['map', notificationId]).deleteIn(['ids', notificationIndex])
  },

  ['@notifications/clear'](state) {
    return state.set('map', Map()).set('ids', List())
  },

  ['@notifications/markRead'](state, { meta: { notificationIds }, error }) {
    if (error) {
      return state
    }

    let map = state.map
    for (const notificationId of notificationIds) {
      if (map.has(notificationId)) {
        map = map.setIn([notificationId, 'read'], true)
      }
    }
    return state.set('map', map)
  },
})
