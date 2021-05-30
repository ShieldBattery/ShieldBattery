import { Map, OrderedSet, Record } from 'immutable'
import { assertUnreachable } from '../../common/assert-unreachable'
import { EMAIL_VERIFICATION_ID, Notification, NotificationType } from '../../common/notifications'
import { keyedReducer } from '../reducers/keyed-reducer'

export interface NotificationRecordBase {
  id: string
  type: NotificationType
  read: boolean
  createdAt: number
  local?: boolean
}

// NOTE(tec27): This is mainly useful if you need to set a field on multiple notifications at once
// and aren't sure what type they actually are. Our type union doesn't produce a usable `set` method
// on its own, but by casting to this type it will be usable.
type CommonNotificationRecord = Record<{ read: boolean; createdAt: 0 }>

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
): NotificationState {
  return state.set(
    'idToNotification',
    state.idToNotification.withMutations(idToNotification => {
      for (const id of notificationIds) {
        idToNotification.update(
          id,
          n => (n as CommonNotificationRecord | undefined)?.set('read', read) as NotificationRecord,
        )
      }
    }),
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
      (n: NotificationRecordBase) => n.local || (timestamp && n.createdAt <= timestamp),
    )
    // Preserve the order of the cleared notification IDs set
    const clearedNotificationIds = state.notificationIds.filter(id =>
      clearedIdToNotification.has(id),
    )

    // Apply the clear changes optimistically
    return state
      .update('idToNotification', m => m.filter(n => !clearedIdToNotification.has(n.id)))
      .update('notificationIds', ids => ids.subtract(clearedNotificationIds))
      .setIn(
        ['clearRequests', reqId],
        new ClearRequestRecord({ clearedIdToNotification, clearedNotificationIds }),
      )
  },

  ['@notifications/clear'](state, action) {
    // If the `reqId` is not provided it means the action was dispatched on a client that didn't
    // issue the request.
    const reqId = action.meta?.reqId

    if (action.error) {
      if (reqId && state.clearRequests.has(reqId)) {
        // Undo the optimistic mutation
        const { clearedIdToNotification, clearedNotificationIds } = state.clearRequests.get(reqId)!

        return state
          .mergeIn(['idToNotification'], clearedIdToNotification)
          .update('notificationIds', ids => clearedNotificationIds.union(ids))
          .deleteIn(['clearRequests', reqId])
      } else {
        // This should never really happen, as this means the action was dispatched for some other
        // client's request
        return state
      }
    } else {
      if (reqId && state.clearRequests.has(reqId)) {
        // Request was succesful, so we can throw away the undo information for the optimistic
        // mutation
        return state.deleteIn(['clearRequests', reqId])
      } else {
        const { timestamp } = action.payload
        const leftoverNotifications = state.idToNotification.filter(
          (n: NotificationRecordBase) => !n.local && n.createdAt > timestamp,
        )

        return state
          .set('idToNotification', leftoverNotifications)
          .update('notificationIds', ids => ids.intersect(leftoverNotifications.keys()))
      }
    }
  },

  ['@notifications/markReadBegin'](state, { payload: { notificationIds } }) {
    // Apply the mark read changes optimistically
    return updateReadStatus(state, notificationIds, true)
  },

  ['@notifications/markRead'](state, { meta: { notificationIds }, error }) {
    // If an error happened, undo the mutations that were done optimistically
    if (error) {
      return updateReadStatus(state, notificationIds, false)
    } else {
      return updateReadStatus(state, notificationIds, true)
    }
  },
})
