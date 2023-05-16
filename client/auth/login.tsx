import queryString from 'query-string'
import React, { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  PASSWORD_MINLENGTH,
  USERNAME_MAXLENGTH,
  USERNAME_MINLENGTH,
  USERNAME_PATTERN,
} from '../../common/constants'
import { useForm } from '../forms/form-hook'
import SubmitOnEnter from '../forms/submit-on-enter'
import { composeValidators, maxLength, minLength, regex, required } from '../forms/validators'
import { RaisedButton } from '../material/button'
import { push } from '../navigation/routing'
import LoadingIndicator from '../progress/dots'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { useStableCallback } from '../state-hooks'
import { logIn } from './action-creators'
import {
  AuthBody,
  AuthBottomAction,
  AuthCheckBox,
  AuthContent,
  AuthContentContainer,
  AuthPasswordTextField,
  AuthTextField,
  AuthTitle,
  BottomActionButton,
  FieldRow,
  ForgotActionButton,
  LoadingArea,
  RowEdge,
  Spacer,
} from './auth-content'
import { redirectIfLoggedIn } from './auth-utils'
import { UserErrorDisplay } from './user-error-display'

interface LoginModel {
  username: string
  password: string
  rememberMe: boolean
}

export function Login() {
  const { t, i18n } = useTranslation()
  const dispatch = useAppDispatch()
  const auth = useAppSelector(s => s.auth)

  const [isLoading, setIsLoading] = useState(false)
  const [lastError, setLastError] = useState<Error>()

  useEffect(() => {
    redirectIfLoggedIn({ auth })
  }, [auth])

  const abortControllerRef = useRef<AbortController>()

  const onFormSubmit = useStableCallback((model: LoginModel) => {
    setIsLoading(true)
    setLastError(undefined)

    abortControllerRef.current?.abort()
    abortControllerRef.current = new AbortController()

    dispatch(
      logIn(
        {
          username: model.username,
          password: model.password,
          remember: model.rememberMe,
          locale: i18n.language,
        },
        {
          onSuccess: () => {},
          onError: err => {
            setIsLoading(false)
            setLastError(err)
          },
          signal: abortControllerRef.current.signal,
        },
      ),
    )
  })

  const queryModel: { username?: string } = queryString.parse(window.location.search)
  const { onSubmit, bindInput, bindCheckable, getInputValue } = useForm<LoginModel>(
    {
      username: queryModel.username ?? '',
      password: '',
      rememberMe: false,
    },
    {
      username: composeValidators(
        required(t('auth.usernameValidator.required', 'Enter a username')),
        minLength(
          USERNAME_MINLENGTH,
          t('auth.usernameValidator.minLength', {
            defaultValue: `Enter at least {{minLength}} characters`,
            minLength: USERNAME_MINLENGTH,
          }),
        ),
        maxLength(
          USERNAME_MAXLENGTH,
          t('auth.usernameValidator.maxLength', {
            defaultValue: `Enter at most {{maxLength}} characters`,
            maxLength: USERNAME_MAXLENGTH,
          }),
        ),
        regex(
          USERNAME_PATTERN,
          t('auth.usernameValidator.pattern', 'Username contains invalid characters'),
        ),
      ),
      password: composeValidators(
        required(t('auth.passwordValidator.required', 'Enter a password')),
        minLength(
          PASSWORD_MINLENGTH,
          t('auth.passwordValidator.minLength2', {
            defaultValue: `Enter at least {{minLength}} characters`,
            minLength: PASSWORD_MINLENGTH,
          }),
        ),
      ),
    },
    { onSubmit: onFormSubmit },
  )

  const onSplashClick = useStableCallback(() => {
    push({ pathname: '/splash' })
  })

  const onCreateAccountClick = useStableCallback(() => {
    const search = queryString.stringify({
      ...queryString.parse(location.search),
      username: getInputValue('username'),
    })
    push({ pathname: '/signup', search })
  })

  const onForgotUsernameClick = useStableCallback(() => {
    push({ pathname: '/forgot-user' })
  })

  const onForgotPasswordClick = useStableCallback(() => {
    push({ pathname: '/forgot-password' })
  })

  let loadingContents
  if (auth.authChangeInProgress || isLoading) {
    loadingContents = (
      <LoadingArea>
        <LoadingIndicator />
      </LoadingArea>
    )
  }

  return (
    <AuthContent>
      <AuthContentContainer isLoading={isLoading || auth.authChangeInProgress}>
        <AuthTitle>{t('auth.login.title', 'Log in')}</AuthTitle>
        <AuthBody>{lastError ? <UserErrorDisplay error={lastError} /> : null}</AuthBody>
        <form noValidate={true} onSubmit={onSubmit}>
          <SubmitOnEnter />
          <FieldRow>
            <RowEdge />
            <AuthTextField
              {...bindInput('username')}
              label={t('common.literals.username', 'Username')}
              floatingLabel={true}
              inputProps={{
                tabIndex: 1,
                autoCapitalize: 'off',
                autoCorrect: 'off',
                spellCheck: false,
              }}
            />
            <RowEdge>
              <ForgotActionButton
                label={t('auth.login.forgotUsername', 'Forgot username?')}
                onClick={onForgotUsernameClick}
              />
            </RowEdge>
          </FieldRow>

          <FieldRow>
            <RowEdge />
            <AuthPasswordTextField
              {...bindInput('password')}
              label={t('common.literals.password', 'Password')}
              floatingLabel={true}
              inputProps={{
                tabIndex: 1,
                autoCapitalize: 'off',
                autoCorrect: 'off',
                spellCheck: false,
              }}
            />
            <RowEdge>
              <ForgotActionButton
                label={t('auth.login.forgotPassword', 'Forgot password?')}
                onClick={onForgotPasswordClick}
              />
            </RowEdge>
          </FieldRow>

          <FieldRow>
            <RowEdge />
            <AuthCheckBox
              {...bindCheckable('rememberMe')}
              label={t('auth.login.rememberMe', 'Remember me')}
              inputProps={{ tabIndex: 1 }}
            />
            <Spacer />
            <RaisedButton
              label={t('common.literals.login', 'Log in')}
              onClick={onSubmit}
              tabIndex={1}
              testName='submit-button'
            />
            <RowEdge />
          </FieldRow>
        </form>
      </AuthContentContainer>

      {loadingContents}

      <AuthBottomAction>
        <BottomActionButton
          label={t('auth.login.signUp', 'Sign up for an account')}
          onClick={onCreateAccountClick}
          tabIndex={1}
        />
        <BottomActionButton
          label={t('auth.login.whatIsShieldBattery', 'What is ShieldBattery?')}
          onClick={onSplashClick}
          tabIndex={1}
        />
      </AuthBottomAction>
    </AuthContent>
  )
}
