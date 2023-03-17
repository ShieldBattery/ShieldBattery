import React, { useCallback } from 'react'
import styled from 'styled-components'
import WarningIcon from '../icons/material/warning-36px.svg'
import logger from '../logging/logger'
import { ActionlessNotification } from '../notifications/notifications'
import { useAppDispatch } from '../redux-hooks'
import { openSnackbar, TIMING_LONG } from '../snackbars/action-creators'
import { amberA400 } from '../styles/colors'
import { sendVerificationEmail } from './action-creators'
import { useSelfUser } from './state-hooks'

const ColoredWarningIcon = styled(WarningIcon)`
  width: 36px;
  height: 36px;
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
                message: 'Verification email has been sent successfully.',
                time: TIMING_LONG,
              }),
            )
          },
          onError: err => {
            logger.error(`Resending verification email failed: ${err?.stack ?? err}`)
            dispatch(
              openSnackbar({
                message:
                  'Something went wrong while sending a verification email, ' +
                  'please try again later.',
                time: TIMING_LONG,
              }),
            )
          },
        }),
      )
    },
    [selfUserId, dispatch],
  )

  return (
    <ActionlessNotification
      ref={ref}
      showDivider={props.showDivider}
      read={props.read}
      icon={<ColoredWarningIcon />}
      text={
        <span data-test='email-verification-notification'>
          Your email is unverified! Check for an email from ShieldBattery. If you don't see one, we
          can{' '}
          <a href='#' onClick={onClick}>
            send another
          </a>
          .
        </span>
      }
    />
  )
})
