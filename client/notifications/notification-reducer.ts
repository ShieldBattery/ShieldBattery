import { Map, OrderedSet, Record } from 'immutable'
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
    local: true as const,
  })
  implements NotificationRecordBase {}

export class PartyInviteNotificationRecord
  extends Record({
    id: '',
    type: NotificationType.PartyInvite as typeof NotificationType.PartyInvite,
    read: false,
    createdAt: 0,
    from: '',
    partyId: '',
  })
  implements NotificationRecordBase {}

export type NotificationRecord = EmailVerificationNotificationRecord | PartyInviteNotificationRecord

function toNotificationRecord(notification: Readonly<Notification>): NotificationRecord {
  switch (notification.type) {
    case NotificationType.EmailVerification:
      return new EmailVerificationNotificationRecord(notification)
    case NotificationType.PartyInvite:
      return new PartyInviteNotificationRecord(notification)
    default:
      return assertUnreachable(notification)
  }
}

function updateReadStatus(
  state: NotificationState,
  notificationIds: string[],
  read: boolean,
): Map<string, NotificationRecord> {
  return Map(
    notificationIds
      .filter(id => state.idToNotification.has(id))
      .map(id => [id, toNotificationRecord({ ...state.idToNotification.get(id)!.toJS(), read })]),
  )
}

export class ClearRequestRecord extends Record({
  clearedIdToNotification: Map<string, NotificationRecord>(),
  clearedNotificationIds: OrderedSet<string>(),
}) {}

class NotificationBaseState extends Record({
  idToNotification: Map<string, NotificationRecord>(),
  notificationIds: OrderedSet<string>(),

  // Cache the values of the clear requests so they can easily be restored if the server returns an
  // error. Doesn't cache the local notifications.
  clearRequests: Map<string, ClearRequestRecord>(),
}) {}

export class NotificationState extends NotificationBaseState {
  get reversedNotificationIds() {
    return this.notificationIds.reverse()
  }
}

export default keyedReducer(new NotificationState(), {
  ['@notifications/serverInit'](state, { payload: { notifications } }) {
    return state
      .update('idToNotification', m =>
        m.merge(notifications.map(n => [n.id, toNotificationRecord(n)])),
      )
      .update('notificationIds', s => s.union(notifications.map(n => n.id)))
  },

  ['@notifications/add'](state, { payload: { notification } }) {
    if (state.idToNotification.has(notification.id)) {
      return state
    }

    return state
      .update('idToNotification', m => m.set(notification.id, toNotificationRecord(notification)))
      .update('notificationIds', s => s.add(notification.id))
  },

  ['@notifications/clearById'](state, { payload: { notificationId } }) {
    return state
      .deleteIn(['idToNotification', notificationId])
      .deleteIn(['notificationIds', notificationId])
  },

  ['@notifications/clearBegin'](state, { payload: { reqId, timestamp } }) {
    const clearedIdToNotification = state.idToNotification.filter(
      n => timestamp && n.createdAt <= timestamp,
    )
    // Preserve the order of the cleared notification IDs set
    const clearedNotificationIds = state.notificationIds.filter(id =>
      clearedIdToNotification.has(id),
    )

    // Apply the clear changes optimistically
    return state
      .update('idToNotification', map =>
        map.filter((n: NotificationRecordBase) => n.local || !clearedIdToNotification.has(n.id)),
      )
      .update('notificationIds', ids => ids.subtract(clearedNotificationIds))
      .setIn(
        ['clearRequests', reqId],
        new ClearRequestRecord({ clearedIdToNotification, clearedNotificationIds }),
      )
  },

  ['@notifications/clear'](state, action) {
    const reqId = action.meta && action.meta.reqId
    // If the `reqId` is not provided it means the action was dispatched on a client that didn't
    // issue the request.
    if (!action.error && (!reqId || !state.clearRequests.has(reqId))) {
      const timestamp = action.payload.timestamp
      const clearedIdToNotification = state.idToNotification.filter(
        n => timestamp && n.createdAt <= timestamp,
      )
      const clearedNotificationIds = state.notificationIds.filter(id =>
        clearedIdToNotification.has(id),
      )

      return state
        .update('idToNotification', map =>
          map.filter((n: NotificationRecordBase) => n.local || !clearedIdToNotification.has(n.id)),
        )
        .update('notificationIds', ids => ids.subtract(clearedNotificationIds))
    }

    // If an error happened, undo the mutations that were done optimistically
    if (action.error && reqId) {
      const clearedIdToNotification = state.clearRequests.get(reqId)?.clearedIdToNotification
      const clearedNotificationIds = state.clearRequests.get(reqId)?.clearedNotificationIds

      return state
        .mergeIn(['idToNotification'], clearedIdToNotification)
        .mergeIn(['notificationIds'], clearedNotificationIds)
        .deleteIn(['clearRequests', reqId])
    }

    return state.deleteIn(['clearRequests', reqId])
  },

  ['@notifications/markReadBegin'](state, { payload: { notificationIds } }) {
    // Apply the mark read changes optimistically
    return state.mergeIn(['idToNotification'], updateReadStatus(state, notificationIds, true))
  },

  ['@notifications/markRead'](state, { meta: { notificationIds }, error }) {
    // If an error happened, undo the mutations that were done optimistically
    if (error) {
      return state.mergeIn(['idToNotification'], updateReadStatus(state, notificationIds, false))
    }

    return state
  },
})
