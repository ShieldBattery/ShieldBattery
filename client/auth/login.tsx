import { useRef, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { Link } from 'wouter'
import { useForm, useFormCallbacks } from '../forms/form-hook'
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

// The recovery links come after the form controls in the DOM so that tabbing (and screen readers)
// move through the controls contiguously, but they're placed visually above their fields.
const StyledForm = styled.form`
  width: 100%;
  margin-bottom: 16px;

  display: grid;
  grid-template-columns: minmax(0, 1fr);
  grid-template-areas:
    'username-link'
    'username'
    'password-link'
    'password'
    'submit';
  row-gap: 4px;
`

const UsernameField = styled(TextField)`
  grid-area: username;
`

const PasswordField = styled(PasswordTextField)`
  grid-area: password;
`

const UsernameRecoveryLink = styled(Link)`
  grid-area: username-link;
  justify-self: end;
`

const PasswordRecoveryLink = styled(Link)`
  grid-area: password-link;
  justify-self: end;
  margin-top: 8px;
`

const RememberAndSubmit = styled.div`
  grid-area: submit;
  margin-top: 8px;

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

  const searchParams = new URLSearchParams(window.location.search)
  const queryModel: { username?: string } = { username: searchParams.get('username') ?? undefined }
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
  const signupSearchParams = new URLSearchParams(location.search)
  if (curUsername) {
    signupSearchParams.set('username', curUsername)
  }
  const signupSearch = signupSearchParams.toString() ? '?' + signupSearchParams.toString() : ''

  return (
    <AuthLayout title={t('auth.login.title', 'Log in to ShieldBattery')}>
      {lastError ? <UserErrorDisplay error={lastError} /> : null}
      <StyledForm noValidate={true} onSubmit={submit}>
        <UsernameField
          {...bindInput('username')}
          label={t('auth.login.username', 'Username')}
          floatingLabel={true}
          inputProps={{
            tabIndex: 0,
            autoCapitalize: 'off',
            autoCorrect: 'off',
            autoFocus: true,
            spellCheck: false,
          }}
          disabled={isLoading}
        />
        <PasswordField
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

        <RememberAndSubmit>
          <RememberCheckBox
            {...bindCheckable('rememberMe')}
            label={t('auth.login.rememberMe', 'Remember me')}
            inputProps={{ tabIndex: 0 }}
            disabled={isLoading}
          />
          <SubmitButton
            type='submit'
            label={t('auth.login.logIn', 'Log in')}
            onClick={submit}
            tabIndex={0}
            testName='submit-button'
            disabled={isLoading}
          />
        </RememberAndSubmit>

        <UsernameRecoveryLink href='/recover-username'>
          {t('auth.login.forgotUsername', 'Recover username')}
        </UsernameRecoveryLink>
        <PasswordRecoveryLink href='/forgot-password'>
          {t('auth.login.forgotPassword', 'Reset password')}
        </PasswordRecoveryLink>
      </StyledForm>
      <div>
        <Trans t={t} i18nKey='auth.login.createAccountLinkText'>
          Don't have an account? <Link href={`/signup${signupSearch}`}>Create an account</Link>
        </Trans>
      </div>
    </AuthLayout>
  )
}
