import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { Link } from 'wouter'
import { useForm, useFormCallbacks } from '../forms/form-hook'
import SubmitOnEnter from '../forms/submit-on-enter'
import { ElevatedButton } from '../material/button'
import { TextField } from '../material/text-field'
import { useAppDispatch } from '../redux-hooks'
import { bodyLarge } from '../styles/typography'
import { recoverUsername } from './action-creators'
import { emailValidator } from './auth-form-validators'
import { AuthLayout } from './auth-layout'
import { UserErrorDisplay } from './user-error-display'

const StyledForm = styled.form`
  width: 100%;
  margin-bottom: 16px;

  display: flex;
  flex-direction: column;
  gap: 12px;
`

const SuccessMessage = styled.div`
  ${bodyLarge};
  color: var(--theme-success);
`

const Explanation = styled.div`
  ${bodyLarge};
  margin-bottom: 20px;
`

interface RecoverUsernameModel {
  email: string
}

export function RecoverUsername() {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error>()
  const [completed, setCompleted] = useState(false)

  const { submit, bindInput, form } = useForm<RecoverUsernameModel>(
    {
      email: '',
    },
    {
      email: emailValidator,
    },
  )

  useFormCallbacks(form, {
    onSubmit: model => {
      setIsLoading(true)
      setError(undefined)

      dispatch(
        recoverUsername(model.email, {
          onSuccess: () => {
            setIsLoading(false)
            setError(undefined)
            setCompleted(true)
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
    <AuthLayout title={t('auth.forgot.user.title', 'Recover your username')}>
      {error ? <UserErrorDisplay error={error} /> : null}
      {completed ? (
        <SuccessMessage data-test='recover-username-success'>
          {t(
            'auth.forgot.user.successMessage',
            'You should receive an email shortly with all the usernames associated with that ' +
              'email address (if any).',
          )}
        </SuccessMessage>
      ) : (
        <StyledForm noValidate={true} onSubmit={submit}>
          <SubmitOnEnter />
          <Explanation>
            {t(
              'auth.forgot.user.enterEmail',
              "Enter the email address associated with your account. We'll send you an email " +
                'with all the usernames associated with that email address (if any).',
            )}
          </Explanation>
          <TextField
            {...bindInput('email')}
            label={t('auth.forgot.user.emailAddress', 'Email address')}
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
            label={t('auth.forgot.user.recoverUsername', 'Recover username')}
            onClick={submit}
            tabIndex={0}
            disabled={isLoading}
          />
        </StyledForm>
      )}
      <Link href='/login'>{t('auth.forgot.backToLogin', 'Back to login')}</Link>
    </AuthLayout>
  )
}
