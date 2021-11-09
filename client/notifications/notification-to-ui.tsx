import React from 'react'
import { assertUnreachable } from '../../common/assert-unreachable'
import { NotificationType, SbNotification } from '../../common/notifications'
import { EmailVerificationNotificationUi } from '../auth/email-verification-notification-ui'
import { PartyInviteNotificationUi } from '../parties/party-notification-ui'
import { PolicyUpdateNotificationUi } from '../policies/policy-update-notification-ui'

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
    default:
      return assertUnreachable(notification)
  }
}
