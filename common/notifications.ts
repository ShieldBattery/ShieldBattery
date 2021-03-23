export enum NotificationType {
  EmailVerification = 'emailVerification',
}

export interface EmailVerificationNotification {
  type: typeof NotificationType.EmailVerification
  id: string
  unread: boolean
}

export const EMAIL_VERIFICATION_ID = 'local-emailVerification'

export type Notification = EmailVerificationNotification
