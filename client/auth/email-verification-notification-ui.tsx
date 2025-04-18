import React, { useCallback, useEffect } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { EMAIL_VERIFICATION_ID, NotificationType } from '../../common/notifications'
import { MaterialIcon } from '../icons/material/material-icon'
import logger from '../logging/logger'
import { addLocalNotification } from '../notifications/action-creators'
import { ActionlessNotification } from '../notifications/notifications'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { DURATION_LONG } from '../snackbars/snackbar-durations'
import { useSnackbarController } from '../snackbars/snackbar-overlay'
import { styledWithAttrs } from '../styles/styled-with-attrs'
import { sendVerificationEmail } from './action-creators'
import { useIsLoggedIn, useSelfUser } from './auth-utils'

const ColoredWarningIcon = styledWithAttrs(MaterialIcon, { icon: 'warning', size: 36 })`
  flex-shrink: 0;
  color: var(--theme-amber);
`

// SORRY(tec27): lol this is the biggest mouthful sorry
export interface EmailVerificationNotificationUiProps {
  showDivider: boolean
  read: boolean
}

export const EmailVerificationNotificationUi = React.forwardRef<
  HTMLDivElement,
  EmailVerificationNotificationUiProps
>((props, ref) => {
  return (
    <ActionlessNotification
      ref={ref}
      showDivider={props.showDivider}
      read={props.read}
      icon={<ColoredWarningIcon />}
      text={<EmailVerificationWarningContent />}
    />
  )
})

export function EmailVerificationWarningContent() {
  const { t } = useTranslation()

  const snackbarController = useSnackbarController()
  const dispatch = useAppDispatch()
  const selfUser = useSelfUser()!
  const selfUserId = selfUser.id

  const onClick = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault()
      dispatch(
        sendVerificationEmail(selfUserId, {
          onSuccess: () => {
            snackbarController.showSnackbar(
              t(
                'auth.emailVerification.emailSent',
                'Verification email has been sent successfully.',
              ),
              DURATION_LONG,
            )
          },
          onError: err => {
            logger.error(`Resending verification email failed: ${String(err?.stack ?? err)}`)
            snackbarController.showSnackbar(
              t(
                'auth.emailVerification.sendError',
                'Something went wrong while sending a verification email, please try again later.',
              ),
              DURATION_LONG,
            )
          },
        }),
      )
    },
    [dispatch, selfUserId, snackbarController, t],
  )

  return (
    <span data-test='email-verification-notification'>
      <Trans t={t} i18nKey='auth.emailVerification.emailUnverifiedMessage'>
        Your email is unverified! Check for an email from ShieldBattery. If you don't see one, we
        can{' '}
        <a href='#' onClick={onClick}>
          send another
        </a>
        .
      </Trans>
    </span>
  )
}

/**
 * Shows a notification to users with unverified emails that prompts them to verify their emails.
 * This will only add a notificaiton right after login/launch, and won't have an effect on users
 * with verified emails.
 */
export function useShowEmailVerificationNotificationIfNeeded() {
  const dispatch = useAppDispatch()
  const isLoggedIn = useIsLoggedIn()
  const isEmailVerified = useAppSelector(s => s.auth.self?.user.emailVerified)

  useEffect(() => {
    if (isLoggedIn && !isEmailVerified) {
      dispatch(
        addLocalNotification({
          id: EMAIL_VERIFICATION_ID,
          type: NotificationType.EmailVerification,
        }),
      )
    }
  }, [isLoggedIn, isEmailVerified, dispatch])
}
