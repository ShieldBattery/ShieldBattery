import React from 'react'
import { makeServerUrl } from '../network/server-url'
import styled from 'styled-components'

import { grey800, colorTextPrimary } from '../styles/colors'
import { Body1Old } from '../styles/typography'

const VerifyEmail = styled.div`
  height: 32px;
  background-color: ${grey800};
  display: flex;
  flex-direction: row;
  justify-content: center;
  align-items: center;
  flex-shrink: 0;
`

const VerifyEmailText = styled(Body1Old)`
  color: ${colorTextPrimary};
`

export default class ContentLayout extends React.Component {
  render() {
    const verifyEmailText = `Your email is unverified! Check for an email from
      ShieldBattery and click the enclosed link. If you don't see one, we can `
    const verifyEmailLink = (
      <a href={makeServerUrl('/send-verification-email')} target='_blank'>
        send another.
      </a>
    )

    return (
      <VerifyEmail>
        <VerifyEmailText>
          {verifyEmailText} {verifyEmailLink}
        </VerifyEmailText>
      </VerifyEmail>
    )
  }
}
