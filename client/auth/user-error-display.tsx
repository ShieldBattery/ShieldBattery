import React from 'react'
import styled from 'styled-components'
import { UserErrorCode } from '../../common/users/sb-user'
import { longTimestamp } from '../i18n/date-formats'
import { FetchError, isFetchError } from '../network/fetch-errors'
import { Subtitle2 } from '../styles/typography'
import { ErrorsContainer } from './auth-content'
import { useTranslation } from 'react-i18next'

const BanReason = styled.div`
  margin-top: 8px;
  margin-bottom: 8px;
`

export interface UserErrorDisplayProps {
  className?: string
  error: Error
}

function showUserError(error: FetchError) {
  const { t } = useTranslation()
  switch (error.code) {
    case UserErrorCode.InvalidCredentials:
      return <span>{t('account.invalidCredentials', 'Incorrect username or password')}</span>
    case UserErrorCode.AccountBanned:
      return (
        <div>
          {t('account.accountBanned', 'This account has been banned.')}
          <BanReason>
            <Subtitle2>{t('common.reason', 'Reason')}:</Subtitle2>
            <span>{(error.body as any).reason}</span>
          </BanReason>
          <span>
            The ban will expire at {longTimestamp.format((error.body as any).expiration)}.
          </span>
        </div>
      )
    case UserErrorCode.SessionExpired:
      return <span>{t('account.sessionExpired', 'Session expired')}</span>
    case UserErrorCode.SuspiciousActivity:
      return (
        <span>
          {t('account.suspiciousActivityDetected', 'Due to suspicious activity detected on this network, creating accounts on the web is currently disabled. Please download the standalone client to create a new account.')}
        </span>
      )
    case UserErrorCode.MachineBanned:
      // TODO(tec27): Show expiration date?
      return <span>{t('account.machineBanned', 'This machine is banned from creating new accounts.')}</span>
    case UserErrorCode.UsernameTaken:
      return <span>{t('account.usernameTaken', 'A user with that name already exists')}</span>

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
    <ErrorsContainer className={className} data-test='errors-container'>
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
