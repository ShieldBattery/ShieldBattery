import React from 'react'
import { NotificationType, SbNotification } from '../../common/notifications'
import { logger } from '../logging/logger'
import { PolicyUpdateNotificationUi } from '../policies/policy-update-notification-ui'
import {
  FriendRequestNotificationUi,
  FriendStartNotificationUi,
} from '../users/relationship-notifications'

/**
 * Returns whether we have a renderable UI for a particular notification. If we don't,
 * NotificationUi should not be rendered. This is mainly useful for notification types that exist
 * but are no longer used.
 */
export function notificationHasUi(notification: SbNotification) {
  switch (notification.type) {
    case NotificationType.PolicyUpdated:
    case NotificationType.FriendRequest:
    case NotificationType.FriendStart:
      return true
    case NotificationType.PartyInvite:
      return false
    default:
      notification satisfies never
      logger.warning(`Unhandled notification type checked for UI: ${(notification as any).type}`)
      return false
  }
}

export interface NotificationUiProps {
  notification: SbNotification
  showDivider: boolean
  ref?: React.Ref<HTMLDivElement>
}

/**
 * Converts a notification entry into the relevant UI elements for displaying in a list or as a
 * popup.
 */
export function NotificationUi({ notification, showDivider, ref }: NotificationUiProps) {
  switch (notification.type) {
    case NotificationType.PartyInvite:
      return null
    case NotificationType.PolicyUpdated:
      return (
        <PolicyUpdateNotificationUi
          ref={ref}
          showDivider={showDivider}
          read={notification.read}
          policyType={notification.policyType}
        />
      )
    case NotificationType.FriendRequest:
      return (
        <FriendRequestNotificationUi
          ref={ref}
          notificationId={notification.id}
          showDivider={showDivider}
          read={notification.read}
          from={notification.from}
        />
      )
    case NotificationType.FriendStart:
      return (
        <FriendStartNotificationUi
          ref={ref}
          showDivider={showDivider}
          read={notification.read}
          otherUser={notification.with}
        />
      )
    default:
      notification satisfies never
      logger.warning(
        `Unhandled notification type when converting to UI: ${(notification as any).type}`,
      )
      return null
  }
}
