import React, { useCallback } from 'react'
import styled from 'styled-components'
import WarningIcon from '../icons/material/warning_black_36px.svg'
import { ActionlessNotification } from '../notifications/notifications'
import { useAppDispatch } from '../redux-hooks'
import { amberA400 } from '../styles/colors'
import { sendVerificationEmail } from './action-creators'

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
  const onClick = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault()
      dispatch(sendVerificationEmail())
    },
    [dispatch],
  )

  return (
    <ActionlessNotification
      ref={ref}
      showDivider={props.showDivider}
      read={props.read}
      icon={<ColoredWarningIcon />}
      text={
        <span>
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
