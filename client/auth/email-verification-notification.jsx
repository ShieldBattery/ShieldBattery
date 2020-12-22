import React from 'react'
import { makeServerUrl } from '../network/server-url'
import styled from 'styled-components'

import { grey800, colorTextPrimary } from '../styles/colors'
import { Body1 } from '../styles/typography'

const VerifyEmail = styled.div`
  height: 32px;
  background-color: ${grey800};
  display: flex;
  flex-direction: row;
  justify-content: center;
  align-items: center;
  flex-shrink: 0;
`

const VerifyEmailText = styled(Body1)`
  color: ${colorTextPrimary};
`

export default class ContentLayout extends React.Component {
  render() {
    const verifyEmailText = `Please verify your email to ensure everything works correctly. In case
      you haven't received it yet,`
    const verifyEmailLink = (
      <a href={makeServerUrl('/send-verification-email')} target='_blank'>
        get verification email.
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
