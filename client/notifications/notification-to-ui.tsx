import React from 'react'
import { assertUnreachable } from '../../common/assert-unreachable.js'
import { NotificationType, SbNotification } from '../../common/notifications.js'
import { EmailVerificationNotificationUi } from '../auth/email-verification-notification-ui.js'
import { logger } from '../logging/logger.js'
import { PartyInviteNotificationUi } from '../parties/party-notification-ui.js'
import { PolicyUpdateNotificationUi } from '../policies/policy-update-notification-ui.js'
import {
  FriendRequestNotificationUi,
  FriendStartNotificationUi,
} from '../users/relationship-notifications.js'

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
  try {
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
        return (
          <PartyInviteNotificationUi
            ref={ref}
            key={key}
            from={notification.from}
            partyId={notification.partyId}
            notificationId={notification.id}
            showDivider={showDivider}
            read={notification.read}
          />
        )
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
        return assertUnreachable(notification)
    }
  } catch (err: any) {
    logger.error(`Error converting notification to UI: ${err?.stack ?? err}`)
    return null
  }
}
