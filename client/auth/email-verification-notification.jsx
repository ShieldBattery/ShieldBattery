import React from 'react'
import PropTypes from 'prop-types'
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
`

const VerifyEmailText = Body1.extend`
  color: ${colorTextPrimary};
`

export default class ContentLayout extends React.Component {
  static propTypes = {
    user: PropTypes.object,
  }

  render() {
    const { user } = this.props

    const verifyEmailText = `Please verify your email to ensure everything works correctly. In case
      you haven't received it yet,`
    const verifyEmailLink = (
      <a
        href={makeServerUrl(`/verify-email?sendEmail=true&userId=${user.id}&email=${user.email}`)}
        target="_blank">
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
