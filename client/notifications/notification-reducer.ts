import { Immutable } from 'immer'
import { intersection, union } from '../../common/data-structures/sets'
import { SbNotification } from '../../common/notifications'
import { immerKeyedReducer } from '../reducers/keyed-reducer'

export interface ClearRequest {
  byId: Map<string, SbNotification>
  idSet: Set<string>
  orderedIds: string[]
}

export interface NotificationState {
  /** A map of notification id -> Notification. */
  byId: Map<string, SbNotification>
  /**
   * A Set of all displayed notifications, ordered by insertion (earliest notification comes first).
   */
  idSet: Set<string>
  /**
   * An array of all displayed notifications, ordered by the typical display order (chronological,
   * newest notification first). This will be kept in sync with `idSet`.
   */
  orderedIds: string[]

  /**
   * Internal bookkeeping for notifications that have been cleared, but the request to do so on
   * the server is still in flight. This generally shouldn't be necessary to use in UIs.
   */
  clearRequests: Map<string, ClearRequest>
}

const DEFAULT_STATE: Immutable<NotificationState> = {
  byId: new Map(),
  idSet: new Set(),
  orderedIds: [],

  clearRequests: new Map(),
}

function removeNotification(state: NotificationState, id: string): void {
  state.byId.delete(id)
  if (state.idSet.has(id)) {
    state.idSet.delete(id)
    const index = state.orderedIds.indexOf(id)
    if (index >= 0) {
      state.orderedIds.splice(index, 1)
    }
  }
}

export default immerKeyedReducer(DEFAULT_STATE, {
  ['@auth/logOut']() {
    return DEFAULT_STATE
  },

  ['@notifications/serverInit'](state, { payload: { notifications } }) {
    // TODO(tec27): There's potentially a race here wherein sending a clear request and then
    // reconnecting to the server delivers notifications that are in the process of being cleared?
    // Could probably be "fixed" by also re-clearing notifications from the main state upon the
    // clear response
    for (let i = notifications.length - 1; i >= 0; i--) {
      const n = notifications[i]

      state.byId.set(n.id, n)
      if (!state.idSet.has(n.id)) {
        state.idSet.add(n.id)
        state.orderedIds.unshift(n.id)
      }
    }
  },

  ['@notifications/add'](state, { payload: { notification } }) {
    state.byId.set(notification.id, notification)
    if (!state.idSet.has(notification.id)) {
      state.idSet.add(notification.id)
      state.orderedIds.unshift(notification.id)
    }
  },

  ['@notifications/clearById'](state, { payload: { notificationId } }) {
    removeNotification(state, notificationId)
  },

  ['@notifications/clearBegin'](state, { payload: { reqId, timestamp } }) {
    const clearedIdMap = new Map<string, SbNotification>()
    for (const n of state.byId.values()) {
      if (n.local || (timestamp && n.createdAt <= timestamp)) {
        clearedIdMap.set(n.id, n)
      }
    }

    // Preserve order from the current state
    const clearedIdSet = intersection(state.idSet, new Set(clearedIdMap.keys()))
    // Note that this assumes that the idSet is in fact ordered (just in reverse from the order
    // we typically want to iterate these things)
    const clearedOrderedIds = Array.from(clearedIdSet.values()).reverse()

    for (const id of clearedOrderedIds) {
      removeNotification(state, id)
    }

    state.clearRequests.set(reqId, {
      byId: clearedIdMap,
      idSet: clearedIdSet,
      orderedIds: clearedOrderedIds,
    })
  },

  ['@notifications/clear'](state, action) {
    // If the `reqId` is not provided it means the action was dispatched on a client that didn't
    // issue the request.
    const reqId = action.meta?.reqId

    if (action.error) {
      if (reqId && state.clearRequests.has(reqId)) {
        // Undo the optimistic mutation
        const req = state.clearRequests.get(reqId)!
        state.clearRequests.delete(reqId)

        for (const n of req.byId.values()) {
          state.byId.set(n.id, n)
        }

        state.idSet = union(req.idSet, state.idSet)
        state.orderedIds = state.orderedIds.concat(req.orderedIds)
      } else {
        // This should never really happen, as it would mean a request error was dispatched for some
        // other client's request
        return
      }
    } else {
      if (reqId && state.clearRequests.has(reqId)) {
        // This client initiated the request and it was successful, so we have already done all the
        // necessary work optimistically. Clean up the request tracking.
        state.clearRequests.delete(reqId)
      } else {
        const { timestamp } = action.payload
        for (const n of state.byId.values()) {
          if (n.local || (timestamp && n.createdAt <= timestamp)) {
            removeNotification(state, n.id)
          }
        }
      }
    }
  },

  ['@notifications/markReadBegin'](state, { payload: { notificationIds } }) {
    // Apply the mark read changes optimistically
    for (const id of notificationIds) {
      const n = state.byId.get(id)
      if (n) {
        n.read = true
      }
    }
  },

  ['@notifications/markRead'](state, { meta: { notificationIds }, error }) {
    // If an error happened, undo the mutations that were done optimistically
    if (error) {
      for (const id of notificationIds) {
        const n = state.byId.get(id)
        if (n) {
          n.read = false
        }
      }
    } else {
      // Otherwise, mark the notifications as read (we potentially redo the optimistic changes here
      // in case this request was initiated by another client)
      for (const id of notificationIds) {
        const n = state.byId.get(id)
        if (n) {
          n.read = true
        }
      }
    }
  },
})
