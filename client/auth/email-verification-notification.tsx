import React from 'react'
import styled from 'styled-components'
import WarningIcon from '../icons/material/warning_black_36px.svg'
import { amberA400, grey800 } from '../styles/colors'
import { body1 } from '../styles/typography'

const VerifyEmail = styled.div`
  width: 100%;
  display: flex;
  padding: 8px 8px;

  flex-direction: row;
  align-items: flex-start;

  background-color: ${grey800};
`

const StyledWarningIcon = styled(WarningIcon)`
  width: 36px;
  height: 36px;
  flex-shrink: 0;

  color: ${amberA400};
`

const VerifyEmailText = styled.div`
  ${body1}
  margin-left: 8px;
`

export interface EmailVerificationNotificationProps {
  sendVerificationEmail: () => void
  className?: string
}

export default function EmailVerificationNotification(props: EmailVerificationNotificationProps) {
  const verifyEmailText = `Your email is unverified! Check for an email from
      ShieldBattery. If you don't see one, we can `
  const verifyEmailLink = (
    <a href='#' onClick={props.sendVerificationEmail}>
      send another.
    </a>
  )

  return (
    <VerifyEmail className={props.className}>
      <StyledWarningIcon />
      <VerifyEmailText>
        {verifyEmailText} {verifyEmailLink}
      </VerifyEmailText>
    </VerifyEmail>
  )
}
