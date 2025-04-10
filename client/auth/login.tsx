import queryString from 'query-string'
import React, { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'wouter'
import {
  PASSWORD_MINLENGTH,
  USERNAME_MAXLENGTH,
  USERNAME_MINLENGTH,
  USERNAME_PATTERN,
} from '../../common/constants'
import { useForm, useFormCallbacks } from '../forms/form-hook'
import SubmitOnEnter from '../forms/submit-on-enter'
import { composeValidators, maxLength, minLength, regex, required } from '../forms/validators'
import { detectedLocale } from '../i18n/i18next'
import { ElevatedButton } from '../material/button'
import { push } from '../navigation/routing'
import LoadingIndicator from '../progress/dots'
import { useStableCallback } from '../react/state-hooks'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
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
import { useRedirectAfterLogin } from './auth-utils'
import { UserErrorDisplay } from './user-error-display'

interface LoginModel {
  username: string
  password: string
  rememberMe: boolean
}

export function Login() {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const auth = useAppSelector(s => s.auth)

  const [isLoading, setIsLoading] = useState(false)
  const [lastError, setLastError] = useState<Error>()

  useRedirectAfterLogin()

  const abortControllerRef = useRef<AbortController>(undefined)

  const queryModel: { username?: string } = queryString.parse(window.location.search)
  const { submit, bindInput, bindCheckable, getInputValue, form } = useForm<LoginModel>(
    {
      username: queryModel.username ?? '',
      password: '',
      rememberMe: false,
    },
    {
      username: composeValidators(
        required(t('auth.usernameValidator.required', 'Enter a username')),
        minLength(USERNAME_MINLENGTH),
        maxLength(USERNAME_MAXLENGTH),
        regex(
          USERNAME_PATTERN,
          t('auth.usernameValidator.pattern', 'Username contains invalid characters'),
        ),
      ),
      password: composeValidators(
        required(t('auth.passwordValidator.required', 'Enter a password')),
        minLength(PASSWORD_MINLENGTH),
      ),
    },
  )
  useFormCallbacks(form, {
    onSubmit: model => {
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
            locale: detectedLocale.getValue(),
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
    },
  })

  const onCreateAccountClick = useStableCallback(() => {
    const search = queryString.stringify({
      ...queryString.parse(location.search),
      username: getInputValue('username'),
    })
    push({ pathname: '/signup', search })
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
      <AuthContentContainer $isLoading={isLoading || auth.authChangeInProgress}>
        <AuthTitle>{t('auth.login.title', 'Log in')}</AuthTitle>
        <AuthBody>{lastError ? <UserErrorDisplay error={lastError} /> : null}</AuthBody>
        <form noValidate={true} onSubmit={submit}>
          <SubmitOnEnter />
          <FieldRow>
            <RowEdge />
            <AuthTextField
              {...bindInput('username')}
              label={t('auth.login.username', 'Username')}
              floatingLabel={true}
              inputProps={{
                tabIndex: 1,
                autoCapitalize: 'off',
                autoCorrect: 'off',
                spellCheck: false,
              }}
            />
            <RowEdge>
              <Link href='/forgot-user'>
                <ForgotActionButton label={t('auth.login.forgotUsername', 'Forgot username?')} />
              </Link>
            </RowEdge>
          </FieldRow>

          <FieldRow>
            <RowEdge />
            <AuthPasswordTextField
              {...bindInput('password')}
              label={t('auth.login.password', 'Password')}
              floatingLabel={true}
              inputProps={{
                tabIndex: 1,
                autoCapitalize: 'off',
                autoCorrect: 'off',
                spellCheck: false,
              }}
            />
            <RowEdge>
              <Link href='/forgot-password'>
                <ForgotActionButton label={t('auth.login.forgotPassword', 'Forgot password?')} />
              </Link>
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
            <ElevatedButton
              label={t('auth.login.logIn', 'Log in')}
              onClick={submit}
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
        <Link href='/splash'>
          <BottomActionButton
            label={t('auth.login.whatIsShieldBattery', 'What is ShieldBattery?')}
            tabIndex={1}
          />
        </Link>
      </AuthBottomAction>
    </AuthContent>
  )
}
