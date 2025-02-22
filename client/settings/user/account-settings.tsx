import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { useMutation, useQuery } from 'urql'
import {
  EMAIL_MAXLENGTH,
  EMAIL_MINLENGTH,
  EMAIL_PATTERN,
  PASSWORD_MINLENGTH,
} from '../../../common/constants'
import { EmailVerificationWarningContent } from '../../auth/email-verification-notification-ui'
import { openDialog } from '../../dialogs/action-creators'
import { CommonDialogProps } from '../../dialogs/common-dialog-props'
import { DialogType } from '../../dialogs/dialog-type'
import { useForm } from '../../forms/form-hook'
import SubmitOnEnter from '../../forms/submit-on-enter'
import {
  composeValidators,
  matchesOther,
  maxLength,
  minLength,
  regex,
  required,
} from '../../forms/validators'
import { graphql, useFragment } from '../../gql'
import { MaterialIcon } from '../../icons/material/material-icon'
import logger from '../../logging/logger'
import { useAutoFocusRef } from '../../material/auto-focus'
import { RaisedButton, TextButton } from '../../material/button'
import Card from '../../material/card'
import { Dialog } from '../../material/dialog'
import { PasswordTextField } from '../../material/password-text-field'
import { TextField } from '../../material/text-field'
import { useAppDispatch } from '../../redux-hooks'
import { openSnackbar } from '../../snackbars/action-creators'
import { useStableCallback } from '../../state-hooks'
import { amberA400, colorDividers, colorError, colorTextSecondary } from '../../styles/colors'
import {
  BodyLarge,
  BodyMedium,
  TitleMedium,
  bodyLarge,
  labelMedium,
  titleLarge,
} from '../../styles/typography'

const Root = styled.div`
  display: flex;
  flex-direction: column;
  gap: 40px;
`

const Section = styled.div``

const SectionHeader = styled.div`
  ${titleLarge};
  margin-bottom: 16px;
`

const ColoredWarningIcon = styled(MaterialIcon).attrs({ icon: 'warning', size: 36 })`
  flex-shrink: 0;
  color: ${amberA400};
`

const EmailVerificationWarning = styled.div`
  max-width: 560px;
  display: flex;
  padding: 16px;

  border: 1px solid ${colorDividers};
  border-radius: 2px;
  gap: 16px;
  margin-bottom: 16px;
`

const UserCard = styled(Card)`
  display: flex;
  flex-direction: column;
  gap: 24px;
`

const EditableItem = styled.div`
  height: 48px;
  display: flex;
  align-items: center;
`

const EditableOverline = styled.div`
  ${labelMedium};
  color: ${colorTextSecondary};
`

const EditableContent = styled.div`
  flex-grow: 1;
`

const EmailItem = styled.div`
  display: flex;
  align-items: baseline;
  gap: 8px;
`

const CurrentUserFragment = graphql(/* GraphQL */ `
  fragment AccountSettings_CurrentUser on CurrentUser {
    id
    name
    loginName
    email
    emailVerified
  }
`)

const AccountSettingsQuery = graphql(/* GraphQL */ `
  query AccountSettings {
    currentUser {
      ...AccountSettings_CurrentUser
    }
  }
`)

export function AccountSettings() {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const [{ data }] = useQuery({
    query: AccountSettingsQuery,
  })
  const currentUser = useFragment(CurrentUserFragment, data?.currentUser)
  const [emailRevealed, setEmailRevealed] = useState(false)

  const onEditEmail = useStableCallback(() => {
    dispatch(
      openDialog({
        type: DialogType.ChangeEmail,
        initData: { currentEmail: currentUser?.email ?? '' },
      }),
    )
  })
  const onChangePassword = useStableCallback(() => {
    dispatch(
      openDialog({
        type: DialogType.ChangePassword,
      }),
    )
  })

  if (!currentUser) {
    return (
      <div>
        {t('settings.user.account.error', 'There was a problem retrieving your user information.')}
      </div>
    )
  }

  let emailText = currentUser.email
  if (!emailRevealed) {
    const lastAt = emailText.lastIndexOf('@')
    emailText = '*'.repeat(lastAt) + emailText.slice(lastAt)
  }

  return (
    <Root>
      <Section>
        {currentUser.emailVerified ? null : (
          <EmailVerificationWarning data-test='email-verification-warning'>
            <ColoredWarningIcon />
            <EmailVerificationWarningContent />
          </EmailVerificationWarning>
        )}

        <UserCard>
          <EditableItem>
            <EditableContent>
              <EditableOverline>
                {t('settings.user.account.displayName', 'Display name')}
              </EditableOverline>
              <TitleMedium>{currentUser.name}</TitleMedium>
            </EditableContent>
            <RaisedButton label={t('common.actions.edit', 'Edit')} disabled={true} />
          </EditableItem>

          <EditableItem>
            <EditableContent>
              <EditableOverline>
                {t('settings.user.account.loginName', 'Login name')}
              </EditableOverline>
              <TitleMedium>{currentUser.loginName}</TitleMedium>
            </EditableContent>
            <RaisedButton label={t('common.actions.edit', 'Edit')} disabled={true} />
          </EditableItem>

          <EditableItem>
            <EditableContent>
              <EditableOverline>{t('settings.user.account.email', 'Email')}</EditableOverline>
              <EmailItem>
                <BodyLarge data-test='account-email-text'>{emailText}</BodyLarge>
                <BodyMedium>
                  <a
                    href='#'
                    data-test='reveal-email-link'
                    onClick={e => {
                      setEmailRevealed(r => !r)
                      e.preventDefault()
                    }}>
                    {emailRevealed
                      ? t('common.actions.hide', 'Hide')
                      : t('common.actions.reveal', 'Reveal')}
                  </a>
                </BodyMedium>
              </EmailItem>
            </EditableContent>
            <RaisedButton
              label={t('common.actions.edit', 'Edit')}
              onClick={onEditEmail}
              testName='edit-email-button'
            />
          </EditableItem>
        </UserCard>
      </Section>

      <Section>
        <SectionHeader>
          {t('settings.user.account.authenticationHeader', 'Authentication')}
        </SectionHeader>
        <RaisedButton
          label={t('settings.user.account.changePasswordButton', 'Change password')}
          onClick={onChangePassword}
          testName='change-password-button'
        />
      </Section>
    </Root>
  )
}

const StyledDialog = styled(Dialog)`
  max-width: 480px;
`

const FormSpacer = styled.div`
  height: 16px;
`

const ErrorMessage = styled.div`
  ${bodyLarge};
  color: ${colorError};
  padding-bottom: 16px;
`

const currentPasswordValidator = composeValidators(
  required(t =>
    t('settings.user.account.passwordValidator.current', 'Enter your current password'),
  ),
  minLength(PASSWORD_MINLENGTH),
)
const newPasswordValidator = composeValidators(
  required(t => t('settings.user.account.passwordValidator.new', 'Enter a new password')),
  minLength(PASSWORD_MINLENGTH),
)
const confirmNewPasswordValidator = composeValidators(
  matchesOther<string, ChangePasswordFormModel>('newPassword', t =>
    t('settings.user.account.passwordValidator.confirm', 'Enter a matching password'),
  ),
)

const TEXT_INPUT_PROPS = {
  autoCapitalize: 'off',
  autoCorrect: 'off',
  spellCheck: false,
  tabIndex: 0,
}

const ChangePasswordMutation = graphql(/* GraphQL */ `
  mutation AccountSettingsChangePassword($currentPassword: String!, $newPassword: String!) {
    updateCurrentUser(currentPassword: $currentPassword, changes: { newPassword: $newPassword }) {
      ...AccountSettings_CurrentUser
    }
  }
`)

interface ChangePasswordFormModel {
  currentPassword: string
  newPassword: string
  confirmNewPassword: string
}

export function ChangePasswordDialog(props: CommonDialogProps) {
  const dispatch = useAppDispatch()
  const { t } = useTranslation()
  const [{ fetching }, changePassword] = useMutation(ChangePasswordMutation)
  const [errorMessage, setErrorMessage] = useState<string>()
  const autoFocusRef = useAutoFocusRef<HTMLInputElement>()

  const { onCancel, dialogRef } = props

  const { bindInput, onSubmit, setInputError } = useForm<ChangePasswordFormModel>(
    { currentPassword: '', newPassword: '', confirmNewPassword: '' },
    {
      currentPassword: currentPasswordValidator,
      newPassword: newPasswordValidator,
      confirmNewPassword: confirmNewPasswordValidator,
    },
    {
      onSubmit: model => {
        setErrorMessage(undefined)
        changePassword({
          currentPassword: model.currentPassword,
          newPassword: model.newPassword,
        })
          .then(result => {
            if (result.error) {
              if (result.error.networkError) {
                setErrorMessage(
                  t('settings.user.account.networkError', 'Network error: {{errorMessage}}', {
                    errorMessage: result.error.networkError.message,
                  }),
                )
              } else if (result.error.graphQLErrors?.length) {
                for (const error of result.error.graphQLErrors) {
                  // TODO(tec27): Either type these error codes or generate types for them from Rust
                  // (with typeshare?)
                  if (error.extensions?.code === 'INVALID_PASSWORD') {
                    setInputError(
                      'currentPassword',
                      t(
                        'settings.user.account.invalidCurrentPassword',
                        'Current password is incorrect',
                      ),
                    )
                    return
                  }
                }

                setErrorMessage(
                  t(
                    'settings.user.account.unknownError',
                    'Something went wrong, please try again later.',
                  ),
                )
              }
            } else {
              dispatch(
                openSnackbar({
                  message: t(
                    'settings.user.account.changePassword.success',
                    'Password changed successfully.',
                  ),
                }),
              )
              onCancel()
            }
          })
          .catch(err => {
            logger.error(`Error changing password: ${err.stack ?? err}`)
          })
      },
    },
  )

  const buttons = [
    <TextButton
      label={t('common.actions.cancel', 'Cancel')}
      key='cancel'
      color='accent'
      onClick={onCancel}
      disabled={fetching}
    />,
    <TextButton
      label={t('common.actions.save', 'Save')}
      key='save'
      color='accent'
      onClick={onSubmit}
      disabled={fetching}
      testName='save-button'
    />,
  ]

  return (
    <StyledDialog
      title={t('settings.user.account.changePassword.dialogTitle', 'Change password')}
      onCancel={onCancel}
      showCloseButton={true}
      buttons={buttons}
      dialogRef={dialogRef}
      testName='change-password-dialog'>
      {errorMessage ? <ErrorMessage>{errorMessage}</ErrorMessage> : null}
      <form noValidate={true} onSubmit={onSubmit}>
        <SubmitOnEnter />
        <PasswordTextField
          {...bindInput('currentPassword')}
          ref={autoFocusRef}
          label={t('settings.user.account.currentPassword', 'Current password')}
          inputProps={TEXT_INPUT_PROPS}
          floatingLabel={true}
          disabled={fetching}
        />

        <FormSpacer />

        <PasswordTextField
          {...bindInput('newPassword')}
          label={t('settings.user.account.newPassword', 'New password')}
          inputProps={TEXT_INPUT_PROPS}
          floatingLabel={true}
          disabled={fetching}
        />
        <PasswordTextField
          {...bindInput('confirmNewPassword')}
          label={t('settings.user.account.confirmNewPassword', 'Confirm new password')}
          inputProps={TEXT_INPUT_PROPS}
          floatingLabel={true}
          disabled={fetching}
        />
      </form>
    </StyledDialog>
  )
}

const emailValidator = composeValidators(
  required(t => t('settings.user.account.changeEmail.requiredError', 'Enter an email address')),
  minLength(EMAIL_MINLENGTH),
  maxLength(EMAIL_MAXLENGTH),
  regex(EMAIL_PATTERN, t =>
    t('settings.user.account.changeEmail.patternError', 'Enter a valid email address'),
  ),
)

const ChangeEmailMutation = graphql(/* GraphQL */ `
  mutation AccountSettingsChangeEmail($currentPassword: String!, $email: String!) {
    updateCurrentUser(currentPassword: $currentPassword, changes: { email: $email }) {
      ...AccountSettings_CurrentUser
    }
  }
`)

interface ChangeEmailFormModel {
  currentPassword: string
  email: string
}

export interface ChangeEmailDialogProps extends CommonDialogProps {
  currentEmail: string
}

export function ChangeEmailDialog(props: ChangeEmailDialogProps) {
  const dispatch = useAppDispatch()
  const { t } = useTranslation()
  const [{ fetching }, changeEmail] = useMutation(ChangeEmailMutation)
  const [errorMessage, setErrorMessage] = useState<string>()
  const autoFocusRef = useAutoFocusRef<HTMLInputElement>()

  const { onCancel, dialogRef } = props

  const { bindInput, onSubmit, setInputError } = useForm<ChangeEmailFormModel>(
    { currentPassword: '', email: props.currentEmail },
    {
      currentPassword: currentPasswordValidator,
      email: emailValidator,
    },
    {
      onSubmit: model => {
        setErrorMessage(undefined)
        changeEmail({
          currentPassword: model.currentPassword,
          email: model.email,
        })
          .then(result => {
            if (result.error) {
              if (result.error.networkError) {
                setErrorMessage(
                  t('settings.user.account.networkError', 'Network error: {{errorMessage}}', {
                    errorMessage: result.error.networkError.message,
                  }),
                )
              } else if (result.error.graphQLErrors?.length) {
                for (const error of result.error.graphQLErrors) {
                  // TODO(tec27): Either type these error codes or generate types for them from Rust
                  // (with typeshare?)
                  if (error.extensions?.code === 'INVALID_PASSWORD') {
                    setInputError(
                      'currentPassword',
                      t(
                        'settings.user.account.invalidCurrentPassword',
                        'Current password is incorrect',
                      ),
                    )
                    return
                  }
                }

                setErrorMessage(
                  t(
                    'settings.user.account.unknownError',
                    'Something went wrong, please try again later.',
                  ),
                )
              }
            } else {
              dispatch(
                openSnackbar({
                  message: t(
                    'settings.user.account.changeEmail.success',
                    'Email changed successfully.',
                  ),
                }),
              )
              onCancel()
            }
          })
          .catch(err => {
            logger.error(`Error changing password: ${err.stack ?? err}`)
          })
      },
    },
  )

  const buttons = [
    <TextButton
      label={t('common.actions.cancel', 'Cancel')}
      key='cancel'
      color='accent'
      onClick={onCancel}
      disabled={fetching}
    />,
    <TextButton
      label={t('common.actions.save', 'Save')}
      key='save'
      color='accent'
      onClick={onSubmit}
      disabled={fetching}
      testName='save-button'
    />,
  ]

  return (
    <StyledDialog
      title={t('settings.user.account.changeEmail.dialogTitle', 'Change email')}
      onCancel={onCancel}
      showCloseButton={true}
      buttons={buttons}
      dialogRef={dialogRef}
      testName='change-email-dialog'>
      {errorMessage ? <ErrorMessage>{errorMessage}</ErrorMessage> : null}
      <form noValidate={true} onSubmit={onSubmit}>
        <SubmitOnEnter />
        <PasswordTextField
          {...bindInput('currentPassword')}
          ref={autoFocusRef}
          label={t('settings.user.account.currentPassword', 'Current password')}
          inputProps={TEXT_INPUT_PROPS}
          floatingLabel={true}
          disabled={fetching}
        />

        <FormSpacer />

        <TextField
          {...bindInput('email')}
          label={t('settings.user.account.email', 'Email')}
          inputProps={TEXT_INPUT_PROPS}
          floatingLabel={true}
          disabled={fetching}
        />
      </form>
    </StyledDialog>
  )
}
