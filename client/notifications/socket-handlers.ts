import type { NydusClient, RouteInfo } from 'nydus-client'
import { NotificationEvent, NotificationType } from '../../common/notifications'
import audioManager, { AvailableSound } from '../audio/audio-manager'
import { dispatch, Dispatchable } from '../dispatch-registry'

/**
 * Sounds to play when receiving an `add` for a notification of a particular type. If a type is not
 * present in this mapping, no sound will be played.
 */
const NOTIFICATION_SOUNDS: Partial<Record<NotificationType, AvailableSound>> = {
  [NotificationType.PartyInvite]: AvailableSound.PartyInvite,
}

const ELECTRON_ONLY_NOTIFICATION_TYPES: ReadonlySet<NotificationType> = new Set([
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
    if (NOTIFICATION_SOUNDS.hasOwnProperty(notification.type)) {
      audioManager.playSound(NOTIFICATION_SOUNDS[notification.type]!)
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
  siteSocket.registerRoute(
    '/notifications/:userId',
    (route: RouteInfo, event: NotificationEvent) => {
      const actionType = event.type as NotificationEvent['type']
      if (!eventToAction[actionType]) return

      const action = eventToAction[actionType]!(event as any)
      if (action) dispatch(action)
    },
  )
}
