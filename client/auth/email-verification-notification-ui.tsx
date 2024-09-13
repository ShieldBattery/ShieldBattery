import React, { useCallback } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { styled } from 'styled-components'
import { MaterialIcon } from '../icons/material/material-icon.js'
import logger from '../logging/logger.js'
import { ActionlessNotification } from '../notifications/notifications.js'
import { useAppDispatch } from '../redux-hooks.js'
import { TIMING_LONG, openSnackbar } from '../snackbars/action-creators.js'
import { amberA400 } from '../styles/colors.js'
import { sendVerificationEmail } from './action-creators.js'
import { useSelfUser } from './auth-utils.js'

const ColoredWarningIcon = styled(MaterialIcon).attrs({ icon: 'warning', size: 36 })`
  flex-shrink: 0;
  color: ${amberA400};
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

  const dispatch = useAppDispatch()
  const selfUser = useSelfUser()!
  const selfUserId = selfUser.id

  const onClick = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault()
      dispatch(
        sendVerificationEmail(selfUserId, {
          onSuccess: () => {
            dispatch(
              openSnackbar({
                message: t(
                  'auth.emailVerification.emailSent',
                  'Verification email has been sent successfully.',
                ),
                time: TIMING_LONG,
              }),
            )
          },
          onError: err => {
            logger.error(`Resending verification email failed: ${String(err?.stack ?? err)}`)
            dispatch(
              openSnackbar({
                message: t(
                  'auth.emailVerification.sendError',
                  'Something went wrong while sending a verification email, ' +
                    'please try again later.',
                ),
                time: TIMING_LONG,
              }),
            )
          },
        }),
      )
    },
    [dispatch, selfUserId, t],
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
