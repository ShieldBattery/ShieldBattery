import React from 'react'
import { NotificationType, SbNotification } from '../../common/notifications'
import { EmailVerificationNotificationUi } from '../auth/email-verification-notification-ui'
import { logger } from '../logging/logger'
import { PolicyUpdateNotificationUi } from '../policies/policy-update-notification-ui'
import {
  FriendRequestNotificationUi,
  FriendStartNotificationUi,
} from '../users/relationship-notifications'

/**
 * Converts a notification entry into the relevant UI elements for displaying in a list or as a
 * popup.
 */
export function notificationToUi(
  notification: SbNotification,
  key: string,
  showDivider: boolean,
  ref?: React.Ref<HTMLDivElement>,
) {
  switch (notification.type) {
    case NotificationType.EmailVerification:
      return (
        <EmailVerificationNotificationUi
          ref={ref}
          key={key}
          showDivider={showDivider}
          read={notification.read}
        />
      )
    case NotificationType.PartyInvite:
      return null
    case NotificationType.PolicyUpdated:
      return (
        <PolicyUpdateNotificationUi
          ref={ref}
          key={key}
          showDivider={showDivider}
          read={notification.read}
          policyType={notification.policyType}
        />
      )
    case NotificationType.FriendRequest:
      return (
        <FriendRequestNotificationUi
          ref={ref}
          key={key}
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
          key={key}
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
