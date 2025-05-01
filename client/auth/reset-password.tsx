import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { Link } from 'wouter'
import { RANDOM_EMAIL_CODE_PATTERN } from '../../common/users/user-network'
import { useForm, useFormCallbacks } from '../forms/form-hook'
import { SubmitOnEnter } from '../forms/submit-on-enter'
import { composeValidators, regex, required } from '../forms/validators'
import { FilledButton } from '../material/button'
import { LinkButton } from '../material/link-button'
import { PasswordTextField } from '../material/password-text-field'
import { TextField } from '../material/text-field'
import { useAppDispatch } from '../redux-hooks'
import { bodyLarge } from '../styles/typography'
import { resetPassword } from './action-creators'
import { confirmPasswordValidator, passwordValidator } from './auth-form-validators'
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

interface ResetPasswordModel {
  code: string
  password: string
  confirmPassword: string
}

const RESET_CODE_EXAMPLE = 'XXXXX-XXXXX'

export function ResetPassword() {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error>()
  const [completed, setCompleted] = useState(false)

  const { submit, bindInput, form } = useForm<ResetPasswordModel>(
    {
      code: '',
      password: '',
      confirmPassword: '',
    },
    {
      code: composeValidators(
        required(t => t('auth.passwordValidator.resetCode', 'Enter your password reset code')),
        regex(RANDOM_EMAIL_CODE_PATTERN, t =>
          t('auth.passwordValidator.resetCodePattern', {
            defaultValue: 'Invalid code. It should look like {{example}}.',
            example: RESET_CODE_EXAMPLE,
          }),
        ),
      ),
      password: passwordValidator,
      confirmPassword: confirmPasswordValidator,
    },
  )

  useFormCallbacks(form, {
    onSubmit: model => {
      setIsLoading(true)
      setError(undefined)

      dispatch(
        resetPassword(model, {
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

  const textInputProps = {
    autoCapitalize: 'off',
    autoCorrect: 'off',
    spellCheck: false,
    tabIndex: 0,
  }

  return (
    <AuthLayout title={t('auth.forgot.reset.title', 'Reset password')}>
      {error ? <UserErrorDisplay error={error} /> : null}
      {completed ? (
        <>
          <SuccessMessage>
            {t('auth.forgot.reset.successMessage', 'Your password has been reset.')}
          </SuccessMessage>
          <LinkButton href='/login' data-test='continue-to-login'>
            <FilledButton
              as='div'
              label={t('auth.forgot.reset.continueToLogin', 'Continue to login')}
              tabIndex={0}
            />
          </LinkButton>
        </>
      ) : (
        <>
          <StyledForm noValidate={true} onSubmit={submit} data-test='reset-password-form'>
            <SubmitOnEnter />
            <Explanation>
              {t(
                'auth.forgot.reset.explanationText',
                'You will receive an email with a reset code. Enter that code here along with your ' +
                  'new password.',
              )}
            </Explanation>
            <TextField
              {...bindInput('code')}
              inputProps={textInputProps}
              label={t('auth.forgot.reset.passwordCode', 'Reset code')}
              floatingLabel={true}
              disabled={isLoading}
            />
            <PasswordTextField
              {...bindInput('password')}
              inputProps={textInputProps}
              label={t('auth.forgot.reset.newPassword', 'New password')}
              floatingLabel={true}
              disabled={isLoading}
            />
            <PasswordTextField
              {...bindInput('confirmPassword')}
              inputProps={textInputProps}
              label={t('auth.forgot.reset.confirmPassword', 'Confirm new password')}
              floatingLabel={true}
              disabled={isLoading}
            />
            <FilledButton
              type='submit'
              testName='submit-button'
              label={t('auth.forgot.reset.setNewPassword', 'Set new password')}
              onClick={submit}
              tabIndex={0}
              disabled={isLoading}
            />
          </StyledForm>
          <Link href='/login'>{t('auth.forgot.backToLogin', 'Back to login')}</Link>
        </>
      )}
    </AuthLayout>
  )
}
