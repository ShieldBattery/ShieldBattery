import type { NydusClient, RouteInfo } from 'nydus-client'
import { NotificationEvent, NotificationType, SbNotification } from '../../common/notifications'
import { UserAvailability } from '../../common/users/availability'
import { audioManager, AvailableSound } from '../audio/audio-manager'
import { dispatch, Dispatchable } from '../dispatch-registry'

/**
 * Sounds to play when receiving an `add` for a notification of a particular type. If a type is not
 * present in this mapping, no sound will be played.
 */
const NOTIFICATION_SOUNDS: Partial<Record<NotificationType, AvailableSound>> = {}

const ELECTRON_ONLY_NOTIFICATION_TYPES: ReadonlySet<NotificationType> = new Set([
  NotificationType.PartyInvite,
  NotificationType.LobbyInvite,
])

/**
 * Whether a notification should skip its popup because the user is in Do Not Disturb. The
 * notification is still recorded in the list; only the alert is held back.
 */
function isQuietedByDoNotDisturb(
  notification: SbNotification,
  availability: UserAvailability,
): boolean {
  return (
    availability === UserAvailability.DoNotDisturb &&
    notification.type === NotificationType.LobbyInvite
  )
}

type EventToActionMap = {
  [E in NotificationEvent['type']]?: (
    event: Extract<NotificationEvent, { type: E }>,
  ) => Dispatchable
}

const eventToAction: EventToActionMap = {
  serverInit: event => (dispatch, getState) => {
    const notifications = IS_ELECTRON
      ? event.notifications
      : event.notifications.filter(n => !ELECTRON_ONLY_NOTIFICATION_TYPES.has(n.type))

    dispatch({
      type: '@notifications/serverInit',
      payload: { notifications },
    })

    // Invites that arrived before a reconnect follow the same rule as new ones, so a user in Do
    // Not Disturb isn't interrupted by them either.
    const { availability } = getState().settings.account
    for (const notification of notifications) {
      if (isQuietedByDoNotDisturb(notification, availability)) {
        dispatch({
          type: '@notifications/markShown',
          payload: { notificationId: notification.id },
        })
      }
    }
  },

  add: event => (dispatch, getState) => {
    const { notification } = event

    if (!IS_ELECTRON && ELECTRON_ONLY_NOTIFICATION_TYPES.has(notification.type)) {
      return
    }
    if (Object.hasOwn(NOTIFICATION_SOUNDS, notification.type)) {
      audioManager.playSound(NOTIFICATION_SOUNDS[notification.type]!)
    }

    dispatch({
      type: '@notifications/add',
      payload: { notification },
    })

    // Marking the quieted notification as shown keeps it from popping up when the user leaves Do
    // Not Disturb, by which point the invite may no longer apply.
    if (isQuietedByDoNotDisturb(notification, getState().settings.account.availability)) {
      dispatch({
        type: '@notifications/markShown',
        payload: { notificationId: notification.id },
      })
    }
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
