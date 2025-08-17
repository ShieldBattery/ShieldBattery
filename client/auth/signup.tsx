import queryString from 'query-string'
import * as React from 'react'
import { useMemo, useRef, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { Link } from 'wouter'
import { apiUrl } from '../../common/urls'
import { UsernameAvailableResponse } from '../../common/users/user-network'
import { openDialog } from '../dialogs/action-creators'
import { DialogType } from '../dialogs/dialog-type'
import { Validator, useForm, useFormCallbacks } from '../forms/form-hook'
import SubmitOnEnter from '../forms/submit-on-enter'
import { composeValidators, debounceValidator, requireChecked } from '../forms/validators'
import { detectedLocale } from '../i18n/i18next'
import { FilledButton } from '../material/button'
import { CheckBox, CheckBoxProps } from '../material/check-box'
import { InputError } from '../material/input-error'
import { PasswordTextField } from '../material/password-text-field'
import { TextField } from '../material/text-field'
import { fetchJson } from '../network/fetch'
import { useAppDispatch } from '../redux-hooks'
import { signUp } from './action-creators'
import {
  confirmPasswordValidator,
  emailValidator,
  passwordValidator,
  usernameValidator,
} from './auth-form-validators'
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

const DialogLinkElem = styled.a`
  position: relative;
  pointer-events: auto;
  z-index: 1;
`

function DialogLink({
  dialogType,
  children,
}: {
  dialogType: DialogType.TermsOfService | DialogType.AcceptableUse | DialogType.PrivacyPolicy
  children: string
}) {
  const dispatch = useAppDispatch()

  return (
    <DialogLinkElem
      href='#'
      onClick={(event: React.MouseEvent) => {
        event.preventDefault()
        event.stopPropagation()
        dispatch(openDialog({ type: dialogType }))
      }}
      tabIndex={0}>
      {children}
    </DialogLinkElem>
  )
}

const CheckBoxes = styled.div`
  margin-bottom: 16px;
`

const CheckBoxError = styled(InputError)`
  padding-left: 30px;
  padding-bottom: 4px;
`

function CheckBoxWithError({
  errorText,
  ...checkboxProps
}: { errorText?: string } & CheckBoxProps) {
  return (
    <>
      <CheckBox {...checkboxProps} />
      {errorText ? <CheckBoxError error={errorText} /> : null}
    </>
  )
}

interface SignupModel {
  username: string
  email: string
  password: string
  confirmPassword: string
  ageConfirmation: boolean
  policyAgreement: boolean
}

export function Signup() {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()

  const [isLoading, setIsLoading] = useState(false)
  const [lastError, setLastError] = useState<Error>()

  useRedirectAfterLogin()

  const usernameAvailable = useMemo<Validator<string, SignupModel>>(() => {
    let lastValidatedName: string | undefined

    return debounceValidator(async (username, _model, _dirty, t) => {
      if (username === lastValidatedName) {
        return undefined
      }

      try {
        const result = await fetchJson<UsernameAvailableResponse>(
          apiUrl`users/username-available/${username}`,
          {
            method: 'POST',
          },
        )
        if (result.available) {
          lastValidatedName = username
          return undefined
        }
      } catch (ignored) {
        lastValidatedName = undefined
        return t(
          'auth.usernameValidator.error',
          'There was a problem checking username availability',
        )
      }

      lastValidatedName = username
      return t('auth.usernameValidator.notAvailable', 'Username is not available')
    }, 350)
  }, [])

  const abortControllerRef = useRef<AbortController>(undefined)

  const queryModel: { username?: string } = queryString.parse(window.location.search)
  const { submit, bindInput, bindCheckable, form } = useForm<SignupModel>(
    {
      username: queryModel.username ?? '',
      email: '',
      password: '',
      confirmPassword: '',
      ageConfirmation: false,
      policyAgreement: false,
    },
    {
      username: composeValidators(usernameValidator, usernameAvailable),
      email: emailValidator,
      password: passwordValidator,
      confirmPassword: confirmPasswordValidator,
      ageConfirmation: requireChecked(),
      policyAgreement: requireChecked(),
    },
  )

  useFormCallbacks(form, {
    onSubmit: model => {
      setIsLoading(true)
      setLastError(undefined)

      abortControllerRef.current?.abort()
      abortControllerRef.current = new AbortController()

      dispatch(
        signUp(
          {
            username: model.username,
            email: model.email,
            password: model.password,
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

  const textInputProps = {
    autoCapitalize: 'off',
    autoCorrect: 'off',
    spellCheck: false,
    tabIndex: 0,
  }

  return (
    <AuthLayout title={t('auth.signup.title', 'Create account')}>
      {lastError ? <UserErrorDisplay error={lastError} /> : null}
      <StyledForm noValidate={true} onSubmit={submit}>
        <SubmitOnEnter />
        <TextField
          {...bindInput('username')}
          inputProps={textInputProps}
          label={t('auth.signup.username', 'Username')}
          floatingLabel={true}
          disabled={isLoading}
        />
        <TextField
          {...bindInput('email')}
          inputProps={textInputProps}
          label={t('auth.signup.emailAddress', 'Email address')}
          floatingLabel={true}
          disabled={isLoading}
        />
        <PasswordTextField
          {...bindInput('password')}
          inputProps={textInputProps}
          label={t('auth.signup.password', 'Password')}
          floatingLabel={true}
          disabled={isLoading}
        />
        <PasswordTextField
          {...bindInput('confirmPassword')}
          inputProps={textInputProps}
          label={t('auth.signup.confirmPassword', 'Confirm password')}
          floatingLabel={true}
          disabled={isLoading}
        />
        <CheckBoxes>
          <CheckBoxWithError
            {...bindCheckable('ageConfirmation')}
            label={t('auth.signup.ageConfirmation', 'I certify that I am 13 years of age or older')}
            inputProps={{ tabIndex: 0 }}
            disabled={isLoading}
          />
          <CheckBoxWithError
            {...bindCheckable('policyAgreement')}
            label={
              <span>
                <Trans t={t} i18nKey='auth.signup.readAndAgree'>
                  I have read and agree to the{' '}
                  <DialogLink dialogType={DialogType.TermsOfService}>Terms of Service</DialogLink>,{' '}
                  <DialogLink dialogType={DialogType.AcceptableUse}>Acceptable Use</DialogLink>, and{' '}
                  <DialogLink dialogType={DialogType.PrivacyPolicy}>Privacy</DialogLink> policies
                </Trans>
              </span>
            }
            inputProps={{ tabIndex: 0 }}
            disabled={isLoading}
          />
        </CheckBoxes>

        <FilledButton
          label={t('auth.signup.createAccount', 'Create account')}
          onClick={submit}
          tabIndex={0}
          testName='submit-button'
          disabled={isLoading}
        />
      </StyledForm>
      <div>
        <Trans t={t} i18nKey='auth.signup.alreadyHaveAccount'>
          Already have an account? <Link href={`/login${location.search}`}>Log in</Link>
        </Trans>
      </div>
    </AuthLayout>
  )
}
