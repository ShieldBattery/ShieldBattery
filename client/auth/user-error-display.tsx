import React from 'react'
import styled from 'styled-components'
import { UserErrorCode } from '../../common/users/sb-user'
import { longTimestamp } from '../i18n/date-formats'
import { FetchError, isFetchError } from '../network/fetch-errors'
import { Subtitle2 } from '../styles/typography'
import { ErrorsContainer } from './auth-content'

const BanReason = styled.div`
  margin-top: 8px;
  margin-bottom: 8px;
`

export interface UserErrorDisplayProps {
  className?: string
  error: Error
}

function showUserError(error: FetchError) {
  switch (error.code) {
    case UserErrorCode.InvalidCredentials:
      return <span>Incorrect username or password</span>
    case UserErrorCode.AccountBanned:
      return (
        <div>
          This account has been banned.
          <BanReason>
            <Subtitle2>Reason:</Subtitle2>
            <span>{(error.body as any).reason}</span>
          </BanReason>
          <span>
            The ban will expire at {longTimestamp.format((error.body as any).expiration)}.
          </span>
        </div>
      )
    case UserErrorCode.SessionExpired:
      return <span>Session expired</span>
    case UserErrorCode.SuspiciousActivity:
      return (
        <span>
          Due to suspicious activity detected on this network, creating accounts on the web is
          currently disabled. Please download the standalone client to create a new account.
        </span>
      )
    case UserErrorCode.MachineBanned:
      // TODO(tec27): Show expiration date?
      return <span>This machine is banned from creating new accounts.</span>
    case UserErrorCode.UsernameTaken:
      return <span>A user with that name already exists</span>

    default:
      return (
        <span>
          An error occurred: {error.status} {error.statusText}
        </span>
      )
  }
}

export function UserErrorDisplay({ className, error }: UserErrorDisplayProps) {
  return (
    <ErrorsContainer className={className}>
      {isFetchError(error) ? (
        showUserError(error)
      ) : (
        <span>
          An error occurred:{' '}
          {error.message === 'Failed to fetch'
            ? 'Failed to connect to the server. ' +
              'Please check your internet connection and try again.'
            : error.message}
        </span>
      )}
    </ErrorsContainer>
  )
}
