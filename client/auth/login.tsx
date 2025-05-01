import queryString from 'query-string'
import React, { useRef, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { Link } from 'wouter'
import { useForm, useFormCallbacks } from '../forms/form-hook'
import SubmitOnEnter from '../forms/submit-on-enter'
import { detectedLocale } from '../i18n/i18next'
import { FilledButton } from '../material/button'
import { CheckBox } from '../material/check-box'
import { PasswordTextField } from '../material/password-text-field'
import { TextField } from '../material/text-field'
import { useAppDispatch } from '../redux-hooks'
import { logIn } from './action-creators'
import { passwordValidator, usernameValidator } from './auth-form-validators'
import { AuthLayout } from './auth-layout'
import { useRedirectAfterLogin } from './auth-utils'
import { UserErrorDisplay } from './user-error-display'

const StyledForm = styled.form`
  width: 100%;
  margin-bottom: 16px;

  display: flex;
  flex-direction: column;
  gap: 12px;
`

const Field = styled.div`
  width: 100%;
  display: flex;
  flex-direction: column-reverse;
  gap: 4px;
`

const FieldRecoveryLink = styled(Link)`
  align-self: flex-end;
`

const RememberAndSubmit = styled.div`
  display: grid;
  grid-template-columns: max-content 1fr max-content;
  gap: 8px;
  align-items: center;
`

const RememberCheckBox = styled(CheckBox)`
  grid-column: 1;
  margin-left: 10px; /* Aligns box at 12px from the left edge, same as text in text field */
`

const SubmitButton = styled(FilledButton)`
  grid-column: -1;
`

interface LoginModel {
  username: string
  password: string
  rememberMe: boolean
}

export function Login() {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()

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
      username: usernameValidator,
      password: passwordValidator,
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

  const curUsername = getInputValue('username')
  const signupSearch = curUsername
    ? '?' +
      queryString.stringify({
        ...queryString.parse(location.search),
        username: curUsername,
      })
    : location.search

  return (
    <AuthLayout title={t('auth.login.title', 'Log in to ShieldBattery')}>
      {lastError ? <UserErrorDisplay error={lastError} /> : null}
      <StyledForm noValidate={true} onSubmit={submit}>
        <SubmitOnEnter />
        <Field>
          <TextField
            {...bindInput('username')}
            label={t('auth.login.username', 'Username')}
            floatingLabel={true}
            inputProps={{
              tabIndex: 0,
              autoCapitalize: 'off',
              autoCorrect: 'off',
              spellCheck: false,
            }}
            disabled={isLoading}
          />
          <FieldRecoveryLink href='/recover-username'>
            {t('auth.login.forgotUsername', 'Recover username')}
          </FieldRecoveryLink>
        </Field>

        <Field>
          <PasswordTextField
            {...bindInput('password')}
            label={t('auth.login.password', 'Password')}
            floatingLabel={true}
            inputProps={{
              tabIndex: 0,
              autoCapitalize: 'off',
              autoCorrect: 'off',
              spellCheck: false,
            }}
            disabled={isLoading}
          />
          <FieldRecoveryLink href='/forgot-password'>
            {t('auth.login.forgotPassword', 'Reset password')}
          </FieldRecoveryLink>
        </Field>

        <RememberAndSubmit>
          <RememberCheckBox
            {...bindCheckable('rememberMe')}
            label={t('auth.login.rememberMe', 'Remember me')}
            inputProps={{ tabIndex: 0 }}
            disabled={isLoading}
          />
          <SubmitButton
            label={t('auth.login.logIn', 'Log in')}
            onClick={submit}
            tabIndex={0}
            testName='submit-button'
            disabled={isLoading}
          />
        </RememberAndSubmit>
      </StyledForm>
      <div>
        <Trans t={t} i18nKey='auth.login.createAccountLinkText'>
          Don't have an account? <Link href={`/signup${signupSearch}`}>Create an account</Link>
        </Trans>
      </div>
    </AuthLayout>
  )
}
