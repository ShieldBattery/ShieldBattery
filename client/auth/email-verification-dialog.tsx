import { useEffect, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { RANDOM_EMAIL_CODE_PATTERN } from '../../common/users/user-network'
import { CommonDialogProps } from '../dialogs/common-dialog-props'
import { useForm, useFormCallbacks } from '../forms/form-hook'
import { composeValidators, regex, required } from '../forms/validators'
import { TransInterpolation } from '../i18n/i18next'
import { TextButton } from '../material/button'
import { Dialog } from '../material/dialog'
import { TextField } from '../material/text-field'
import { useAppDispatch } from '../redux-hooks'
import { bodyLarge, BodyLarge, bodyMedium, titleMedium } from '../styles/typography'
import { sendVerificationEmail, verifyEmail } from './action-creators'
import { useSelfUser } from './auth-utils'

const StyledDialog = styled(Dialog)`
  max-width: 540px;
`

const ErrorText = styled.div`
  ${bodyLarge};
  color: var(--theme-error);
  margin-bottom: 12px;
`

const Explanation = styled.div`
  ${bodyMedium};
  margin-bottom: 24px;
`

const Instructions = styled.div`
  ${bodyLarge};
  margin-bottom: 12px;
`

const EmailText = styled.span`
  ${titleMedium};
`

const ResendContainer = styled.div`
  margin-top: 12px;
  display: flex;
  align-items: center;
  gap: 8px;
`

const ResentMsg = styled.span`
  ${bodyLarge};
  color: var(--theme-success);
`

const CODE_EXAMPLE = 'XXXXX-XXXXX'

interface EmailVerificationDialogProps extends CommonDialogProps {
  showExplanation?: boolean
}

interface EmailVerificationModel {
  code: string
}

export function EmailVerificationDialog({
  showExplanation,
  onCancel,
}: EmailVerificationDialogProps) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const selfUser = useSelfUser()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isResending, setIsResending] = useState(false)
  const [resent, setResent] = useState(false)
  const [submitError, setSubmitError] = useState<Error | undefined>()

  const { submit, bindInput, getInputValue, form } = useForm<EmailVerificationModel>(
    { code: '' },
    {
      code: composeValidators(
        required(t => t('auth.emailVerification.codeRequired', 'Enter your verification code')),
        regex(RANDOM_EMAIL_CODE_PATTERN, t =>
          t('auth.emailVerification.codePattern', {
            defaultValue: 'Invalid code. It should look like {{example}}.',
            example: CODE_EXAMPLE,
          }),
        ),
      ),
    },
  )

  useEffect(() => {
    if (selfUser && selfUser.emailVerified) {
      onCancel()
    }
  }, [selfUser, onCancel])

  useFormCallbacks(form, {
    onSubmit: model => {
      if (!selfUser) {
        return
      }

      setIsSubmitting(true)
      setSubmitError(undefined)
      setResent(false)
      dispatch(
        verifyEmail(
          { userId: selfUser.id, code: model.code },
          {
            onSuccess: () => {
              setIsSubmitting(false)
              onCancel()
            },
            onError: err => {
              setIsSubmitting(false)
              setSubmitError(err)
            },
          },
        ),
      )
    },
  })

  const handleResend = () => {
    if (!selfUser) {
      return
    }

    setIsResending(true)
    setResent(false)
    setSubmitError(undefined)
    dispatch(
      sendVerificationEmail(selfUser.id, {
        onSuccess: () => {
          setIsResending(false)
          setResent(true)
        },
        onError: err => {
          setIsResending(false)
          setSubmitError(err)
        },
      }),
    )
  }

  const buttons = [
    <TextButton
      label={t('common.actions.cancel', 'Cancel')}
      key='cancel'
      onClick={onCancel}
      testName='cancel-button'
    />,
    <TextButton
      label={t('auth.emailVerification.verify', 'Verify')}
      key='verify'
      onClick={submit}
      disabled={isSubmitting || !getInputValue('code')}
      testName='verify-button'
    />,
  ]

  const email = selfUser?.email

  return (
    <StyledDialog
      title={t('auth.emailVerification.title', 'Verify your email')}
      onCancel={onCancel}
      showCloseButton={true}
      buttons={buttons}
      testName='email-verification-dialog'>
      {showExplanation ? (
        <Explanation>
          <Trans i18nKey='auth.emailVerification.explanation'>
            Your email address has not been verified. Verifying your email helps us keep your
            account secure and allows us to assist you if you forget your login information.
          </Trans>
        </Explanation>
      ) : null}
      <Instructions>
        <Trans i18nKey='auth.emailVerification.instructions'>
          Enter the verification code sent to{' '}
          <EmailText>{{ email } as TransInterpolation}</EmailText>.
        </Trans>
      </Instructions>
      {submitError ? (
        <ErrorText data-test='submit-error'>
          {t(
            'auth.emailVerification.submitError',
            'There was a problem verifying your email. Please try again later.',
          )}
        </ErrorText>
      ) : null}
      <form onSubmit={submit}>
        <TextField
          {...bindInput('code')}
          label={t('auth.emailVerification.codeLabel', 'Verification code')}
          disabled={isSubmitting}
          inputProps={{ tabIndex: 0, autoCapitalize: 'off', autoCorrect: 'off', spellCheck: false }}
        />
        <ResendContainer>
          <BodyLarge>{t('auth.emailVerification.resendText', "Don't see the email?")}</BodyLarge>
          <TextButton
            label={t('auth.emailVerification.resend', 'Resend email')}
            onClick={handleResend}
            disabled={isResending || resent}
          />
          {resent ? (
            <ResentMsg>
              {t('auth.emailVerification.resent', 'Verification email resent!')}
            </ResentMsg>
          ) : null}
        </ResendContainer>
      </form>
    </StyledDialog>
  )
}
