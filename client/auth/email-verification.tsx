import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import swallowNonBuiltins from '../../common/async/swallow-non-builtins'
import { UserErrorCode } from '../../common/users/sb-user'
import logger from '../logging/logger'
import { push } from '../navigation/routing'
import { LoadingDotsArea } from '../progress/dots'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { logOut, sendVerificationEmail, verifyEmail } from './action-creators'
import {
  AuthBody,
  AuthBottomAction,
  AuthContent,
  AuthContentContainer,
  AuthTitle,
  BottomActionButton,
  ErrorsContainer,
  SuccessContainer,
} from './auth-content'
import { createNextPath, isLoggedIn } from './auth-utils'

export function EmailVerificationUi() {
  const { t } = useTranslation()

  const dispatch = useAppDispatch()
  const auth = useAppSelector(s => s.auth)
  const loggedIn = !!auth.user?.name
  const curUserId = auth.user?.id
  const [resending, setResending] = useState(false)
  const [resendError, setResendError] = useState<Error>()
  const [emailResent, setEmailResent] = useState(false)
  const reqIdRef = useRef<string>()

  const urlParams = useMemo(() => {
    try {
      const url = new URL(window.location.href)
      return url.searchParams
    } catch (err) {
      logger.error('Failed to parse current location: ' + ((err as any)?.stack ?? err))
      return new URLSearchParams()
    }
  }, [])

  const token = urlParams.get('token')
  const forUserId = urlParams.has('userId') ? Number(urlParams.get('userId')) : undefined
  const forUsername = urlParams.get('username')

  const emailVerified = curUserId === forUserId && auth.user?.emailVerified

  const onLogInClick = useCallback(() => {
    const search =
      createNextPath(window.location) +
      (forUsername ? `&username=${encodeURIComponent(forUsername)}` : '')
    push({ pathname: '/login', search })
  }, [forUsername])

  const onSwitchUserClick = useCallback(() => {
    const { id, action, promise } = logOut()
    reqIdRef.current = id
    promise
      .then(() => {
        onLogInClick()
      })
      .catch(swallowNonBuiltins)

    dispatch(action)
  }, [dispatch, onLogInClick])

  const onResendClick = useCallback(() => {
    setResendError(undefined)
    setResending(true)
    dispatch(
      sendVerificationEmail(curUserId, {
        onSuccess: () => {
          setResending(false)
          setEmailResent(true)
        },
        onError: err => {
          setResending(false)
          setResendError(err)
          logger.error(`Resending verification email failed: ${String(err?.stack ?? err)}`)
        },
      }),
    )
  }, [curUserId, dispatch])

  const onContinueClick = useCallback(() => {
    push('/')
  }, [])

  useEffect(() => {
    if (loggedIn && curUserId === forUserId && !emailVerified) {
      const { id, action } = verifyEmail(curUserId, String(token))
      reqIdRef.current = id
      dispatch(action)
    }
  }, [emailVerified, token, forUserId, loggedIn, curUserId, dispatch])

  const { authChangeInProgress, lastFailure } = auth

  let contents: React.ReactNode | undefined
  let bottomActionButton: React.ReactNode | undefined
  if (!isLoggedIn(auth)) {
    contents = (
      <ErrorsContainer data-test='not-logged-in-error'>
        <Trans t={t} i18nKey='auth.emailVerification.loggedOutError'>
          Error: You need to be logged in to verify your email. Please log in by clicking the button
          below and try again.
        </Trans>
      </ErrorsContainer>
    )
    bottomActionButton = (
      <BottomActionButton
        label={t('auth.emailVerification.logIn', 'Log in')}
        onClick={onLogInClick}
        testName='log-in-button'
      />
    )
  } else if (resendError) {
    contents = (
      <ErrorsContainer>
        <Trans t={t} i18nKey='auth.emailVerification.resendError'>
          Error resending email: {{ error: resendError }}
        </Trans>
      </ErrorsContainer>
    )
  } else if (emailResent) {
    contents = (
      <SuccessContainer data-test='email-resent-success'>
        <Trans t={t} i18nKey='auth.emailVerification.resendSuccess'>
          A new verification code has been sent to your account's email address.
        </Trans>
      </SuccessContainer>
    )
  } else if (forUserId !== undefined && forUserId !== curUserId) {
    contents = (
      <ErrorsContainer data-test='wrong-user-error'>
        <Trans t={t} i18nKey='auth.emailVerification.wrongUserError'>
          Error: You must be logged into the account whose email you want to verify. Please switch
          users by clicking the button below and try again.
        </Trans>
      </ErrorsContainer>
    )
    bottomActionButton = (
      <BottomActionButton
        label={t('auth.emailVerification.switchUser', 'Switch user')}
        onClick={onSwitchUserClick}
        testName='switch-user-button'
      />
    )
  } else if (reqIdRef.current && lastFailure && lastFailure.reqId === reqIdRef.current) {
    if (lastFailure.code === UserErrorCode.InvalidCode) {
      contents = (
        <ErrorsContainer data-test='invalid-code-error'>
          <Trans t={t} i18nKey='auth.emailVerification.invalidCodeError'>
            Error: The provided email or verification code is not valid. If the verification code
            matches the one you were emailed, it may have expired. Please request a new verification
            email and try again.
          </Trans>
        </ErrorsContainer>
      )
      bottomActionButton = (
        <BottomActionButton
          label={t('auth.emailVerification.resendVerificationEmail', 'Resend verification email')}
          onClick={onResendClick}
          testName='resend-email-button'
        />
      )
    } else {
      contents = (
        <ErrorsContainer>
          <Trans t={t} i18nKey='auth.emailVerification.generalError'>
            Error: {{ error: lastFailure.err }}
          </Trans>
        </ErrorsContainer>
      )
    }
  } else if (emailVerified) {
    contents = (
      <SuccessContainer>
        <Trans t={t} i18nKey='auth.emailVerification.verifySuccess'>
          Your email has been successfully verified.
        </Trans>
      </SuccessContainer>
    )
    bottomActionButton = (
      <BottomActionButton
        label={t('common.actions.continue', 'Continue')}
        onClick={onContinueClick}
        testName='continue-button'
      />
    )
  } else if (!authChangeInProgress) {
    contents = (
      <ErrorsContainer>
        <Trans t={t} i18nKey='auth.emailVerification.defaultError'>
          Something went terribly wrong. Please try again.
        </Trans>
      </ErrorsContainer>
    )
  }

  return (
    <AuthContent>
      <AuthContentContainer isLoading={authChangeInProgress || resending}>
        <AuthTitle as='h3'>{t('auth.emailVerification.title', 'Verify email')}</AuthTitle>
        <AuthBody>{contents}</AuthBody>
        {bottomActionButton ? <AuthBottomAction>{bottomActionButton}</AuthBottomAction> : null}
      </AuthContentContainer>
      {authChangeInProgress || resending ? <LoadingDotsArea /> : null}
    </AuthContent>
  )
}
