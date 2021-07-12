import { Set } from 'immutable'
import type { NydusClient, RouteHandler, RouteInfo } from 'nydus-client'
import { NotificationEvent, NotificationType } from '../../common/notifications'
import { dispatch, Dispatchable } from '../dispatch-registry'

const ELECTRON_ONLY_NOTIFICATION_TYPES = Set<Readonly<NotificationType>>([
  NotificationType.PartyInvite,
])

type EventToActionMap = {
  [E in NotificationEvent['type']]?: (
    event: Extract<NotificationEvent, { type: E }>,
  ) => Dispatchable
}

const eventToAction: EventToActionMap = {
  serverInit: event => {
    const notifications = IS_ELECTRON
      ? event.notifications
      : event.notifications.filter(n => !ELECTRON_ONLY_NOTIFICATION_TYPES.has(n.type))

    return {
      type: '@notifications/serverInit',
      payload: { notifications },
    }
  },

  add: event => dispatch => {
    const { notification } = event

    if (!IS_ELECTRON && ELECTRON_ONLY_NOTIFICATION_TYPES.has(notification.type)) {
      return
    }

    dispatch({
      type: '@notifications/add',
      payload: { notification },
    })
  },

  clear: event => {
    const { timestamp } = event
    return {
      type: '@notifications/clear',
      payload: { timestamp },
    }
  },

  clearById: event => {
    const { notificationId } = event
    return {
      type: '@notifications/clearById',
      payload: { notificationId },
    }
  },

  markRead: event => {
    const { notificationIds } = event
    return {
      type: '@notifications/markRead',
      meta: { notificationIds },
    }
  },
}

export default function registerModule({ siteSocket }: { siteSocket: NydusClient }) {
  const notificationsHandler: RouteHandler = (route: RouteInfo, event: NotificationEvent) => {
    const actionType = event.type as NotificationEvent['type']
    if (!eventToAction[actionType]) return

    const action = eventToAction[actionType]!(event as any)
    if (action) dispatch(action)
  }

  siteSocket.registerRoute('/notifications/:userId', notificationsHandler)
}
