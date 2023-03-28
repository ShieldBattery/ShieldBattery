import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import { useTranslation } from 'react-i18next'

export function EmailVerificationUi() {
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
          logger.error(`Resending verification email failed: ${err?.stack ?? err}`)
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
  const { t } = useTranslation()

  let contents: React.ReactNode | undefined
  let bottomActionButton: React.ReactNode | undefined
  if (!isLoggedIn(auth)) {
    contents = (
      <ErrorsContainer data-test='not-logged-in-error'>
        {t('account.errorEmailVerificationLoggedOut', 'Error: You need to be logged in to verify your email. Please log in by clicking the button below and try again.')}
      </ErrorsContainer>
    )
    bottomActionButton = (
      <BottomActionButton label={t('common.login', 'Log in')} onClick={onLogInClick} testName='log-in-button' />
    )
  } else if (resendError) {
    contents = (
      <ErrorsContainer>
        <>{t('account.errorResendingEmail', 'Error resending email:')} {resendError}</>
      </ErrorsContainer>
    )
  } else if (emailResent) {
    contents = (
      <SuccessContainer data-test='email-resent-success'>
        {t('account.newVerificationCodeSent', 'A new verification code has been sent to your email address.')}
      </SuccessContainer>
    )
  } else if (forUserId !== undefined && forUserId !== curUserId) {
    contents = (
      <ErrorsContainer data-test='wrong-user-error'>
        {t('account.errorEmailVerificationSwitchUsers', 'Error: You need must be logged into the account whose email you want to verify. Please switch users by clicking the button below and try again.')}
      </ErrorsContainer>
    )
    bottomActionButton = (
      <BottomActionButton
        label='Switch user'
        onClick={onSwitchUserClick}
        testName='switch-user-button'
      />
    )
  } else if (reqIdRef.current && lastFailure && lastFailure.reqId === reqIdRef.current) {
    if (lastFailure.code === UserErrorCode.InvalidCode) {
      contents = (
        <ErrorsContainer data-test='invalid-code-error'>
          {t('account.invalidVerificationCodeError', 'Error: The provided email or verification code is not valid. If the verification code matches the one you were emailed, it may have expired. Please request a new verification email and try again.')}
        </ErrorsContainer>
      )
      bottomActionButton = (
        <BottomActionButton
          label={t('account.resendVerificationEmail', 'Resend verification email')}
          onClick={onResendClick}
          testName='resend-email-button'
        />
      )
    } else {
      contents = <ErrorsContainer>{t('common.error', 'Error')}: {lastFailure.err}</ErrorsContainer>
    }
  } else if (emailVerified) {
    contents = <SuccessContainer>{t('account.emailVerifySuccess', 'Your email has been successfully verified.')}</SuccessContainer>
    bottomActionButton = (
      <BottomActionButton label={t('common.continue', 'Continue')} onClick={onContinueClick} testName='continue-button' />
    )
  } else if (!authChangeInProgress) {
    contents = <ErrorsContainer>{t('common.genericError', 'Something went terribly wrong. Please try again.')}</ErrorsContainer>
  }

  return (
    <AuthContent>
      <AuthContentContainer isLoading={authChangeInProgress || resending}>
        <AuthTitle as='h3'>{t('account.verifyEmail', 'Verify email')}</AuthTitle>
        <AuthBody>{contents}</AuthBody>
        {bottomActionButton ? <AuthBottomAction>{bottomActionButton}</AuthBottomAction> : null}
      </AuthContentContainer>
      {authChangeInProgress || resending ? <LoadingDotsArea /> : null}
    </AuthContent>
  )
}
