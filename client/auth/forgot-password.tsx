import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { Link } from 'wouter'
import { useForm, useFormCallbacks } from '../forms/form-hook'
import SubmitOnEnter from '../forms/submit-on-enter'
import { ElevatedButton } from '../material/button'
import { TextField } from '../material/text-field'
import { replace } from '../navigation/routing'
import { useAppDispatch } from '../redux-hooks'
import { BodyLarge } from '../styles/typography'
import { requestPasswordReset } from './action-creators'
import { emailValidator, usernameValidator } from './auth-form-validators'
import { AuthLayout } from './auth-layout'
import { UserErrorDisplay } from './user-error-display'

const StyledForm = styled.form`
  width: 100%;
  margin-bottom: 16px;

  display: flex;
  flex-direction: column;
  gap: 12px;
`

interface ForgotPasswordModel {
  email: string
  username: string
}

export function ForgotPassword() {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error>()

  const { submit, bindInput, form } = useForm<ForgotPasswordModel>(
    {
      email: '',
      username: '',
    },
    {
      email: emailValidator,
      username: usernameValidator,
    },
  )

  useFormCallbacks(form, {
    onSubmit: model => {
      setIsLoading(true)
      setError(undefined)

      dispatch(
        requestPasswordReset(model, {
          onSuccess: () => {
            replace('/reset-password')
          },
          onError: err => {
            setIsLoading(false)
            setError(err)
          },
        }),
      )
    },
  })

  return (
    <AuthLayout title={t('auth.forgot.password.title', 'Request password reset')}>
      {error ? <UserErrorDisplay error={error} /> : null}
      <StyledForm noValidate={true} onSubmit={submit}>
        <SubmitOnEnter />
        <BodyLarge>
          {t(
            'auth.forgot.password.explanationText',
            "Enter the email address and username associated with your account. We'll send you " +
              'an email with a reset code to set a new password.',
          )}
        </BodyLarge>
        <Link href='/reset-password'>
          {t('auth.forgot.password.alreadyHaveCodeLink', 'Already have a code?')}
        </Link>
        <TextField
          {...bindInput('email')}
          label={t('auth.forgot.password.emailAddress', 'Email address')}
          floatingLabel={true}
          inputProps={{
            tabIndex: 0,
            autoCapitalize: 'off',
            autoCorrect: 'off',
            spellCheck: false,
          }}
          disabled={isLoading}
        />
        <TextField
          {...bindInput('username')}
          label={t('auth.forgot.password.username', 'Username')}
          floatingLabel={true}
          inputProps={{
            tabIndex: 0,
            autoCapitalize: 'off',
            autoCorrect: 'off',
            spellCheck: false,
          }}
          disabled={isLoading}
        />
        <ElevatedButton
          type='submit'
          testName='submit-button'
          label={t('auth.forgot.password.sendResetEmail', 'Send reset email')}
          onClick={submit}
          tabIndex={0}
          disabled={isLoading}
        />
      </StyledForm>
      <Link href='/login'>{t('auth.forgot.backToLogin', 'Back to login')}</Link>
    </AuthLayout>
  )
}
