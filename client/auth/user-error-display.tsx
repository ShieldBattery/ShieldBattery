import { Trans, useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { UserErrorCode } from '../../common/users/user-network'
import { longTimestamp } from '../i18n/date-formats'
import { TransInterpolation } from '../i18n/i18next'
import { FetchError, isFetchError } from '../network/fetch-errors'
import { TitleMedium } from '../styles/typography'

const BanReason = styled.div`
  margin-top: 8px;
  margin-bottom: 8px;
`

const ErrorsContainer = styled.div`
  color: var(--theme-error);
`

export interface UserErrorDisplayProps {
  className?: string
  error: Error
}

function UserError({ error }: { error: FetchError }) {
  const { t } = useTranslation()

  switch (error.code) {
    case UserErrorCode.InvalidCredentials:
      return (
        <span>
          {t('auth.userErrorDisplay.invalidCredentials', 'Incorrect username or password')}
        </span>
      )
    case UserErrorCode.AccountBanned: {
      const banReason = error.body
        ? (error.body as any).reason
        : t('auth.userErrorDisplay.banWithoutReason', 'No reason specified')
      return (
        <div data-test='user-banned-text'>
          <Trans t={t} i18nKey='auth.userErrorDisplay.accountBanned'>
            This account has been banned.
            <BanReason>
              <TitleMedium>Reason:</TitleMedium>
              <span>{{ banReason } as TransInterpolation}</span>
            </BanReason>
            <span>
              The ban will expire at{' '}
              {
                {
                  expireTime: longTimestamp.format((error.body as any).expiration),
                } as TransInterpolation
              }
              .
            </span>
          </Trans>
        </div>
      )
    }
    case UserErrorCode.SessionExpired:
      return <span>{t('auth.userErrorDisplay.sessionExpired', 'Session expired')}</span>
    case UserErrorCode.MachineBanned:
      // TODO(tec27): Show expiration date?
      return (
        <span>
          {t(
            'auth.userErrorDisplay.machineBanned',
            'This machine is banned from creating new accounts.',
          )}
        </span>
      )
    case UserErrorCode.UsernameTakenOrRestricted:
      return (
        <span>{t('auth.userErrorDisplay.usernameTaken', 'The username is not available.')}</span>
      )
    case UserErrorCode.InvalidCode:
      return (
        <span data-test='invalid-code-text'>
          {t(
            'auth.userErrorDisplay.invalidCode',
            'The provided code is invalid. It may have expired.',
          )}
        </span>
      )

    default:
      return (
        <span>
          <Trans t={t} i18nKey='auth.userErrorDisplay.defaultError'>
            An error occurred: {{ status: error.status }} {{ statusText: error.statusText }}
          </Trans>
        </span>
      )
  }
}

export function UserErrorDisplay({ className, error }: UserErrorDisplayProps) {
  const { t } = useTranslation()

  const errorMessage =
    error.message === 'Failed to fetch'
      ? t(
          'auth.userErrorDisplay.noConnectionErrorMessage',
          'Failed to connect to the server. Please check your internet connection and try again.',
        )
      : error.message

  return (
    <ErrorsContainer className={className} data-test='errors-container'>
      {isFetchError(error) ? (
        <UserError error={error} />
      ) : (
        <span>
          <Trans t={t} i18nKey='auth.userErrorDisplay.genericError'>
            An error occurred: {{ errorMessage }}
          </Trans>
        </span>
      )}
    </ErrorsContainer>
  )
}
