import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { useMutation, useQuery } from 'urql'
import {
  EMAIL_MAXLENGTH,
  EMAIL_MINLENGTH,
  EMAIL_PATTERN,
  PASSWORD_MINLENGTH,
} from '../../../common/constants'
import { getErrorStack } from '../../../common/errors'
import { LOGIN_NAME_CHANGE_COOLDOWN_MS } from '../../../common/users/sb-user'
import {
  createUsernameAvailabilityValidator,
  usernameValidator,
} from '../../auth/auth-form-validators'
import { useSelfUser } from '../../auth/auth-utils'
import { openDialog } from '../../dialogs/action-creators'
import { CommonDialogProps } from '../../dialogs/common-dialog-props'
import { DialogType } from '../../dialogs/dialog-type'
import { useForm, useFormCallbacks } from '../../forms/form-hook'
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
import { FilledButton, TextButton } from '../../material/button'
import { Card } from '../../material/card'
import { Dialog } from '../../material/dialog'
import { PasswordTextField } from '../../material/password-text-field'
import { TextField } from '../../material/text-field'
import { Tooltip } from '../../material/tooltip'
import { useAppDispatch } from '../../redux-hooks'
import { useSnackbarController } from '../../snackbars/snackbar-overlay'
import { styledWithAttrs } from '../../styles/styled-with-attrs'
import {
  BodyLarge,
  bodyLarge,
  BodyMedium,
  labelMedium,
  titleLarge,
  TitleMedium,
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
  color: var(--theme-on-surface-variant);
`

const EditableContent = styled.div`
  flex-grow: 1;
`

const EmailItem = styled.div`
  display: flex;
  align-items: baseline;
  gap: 8px;
`

const EmailItemAndIcon = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
`

const MultiButtons = styled.div`
  display: flex;
  gap: 8px;
`

const VerifiedIcon = styledWithAttrs(MaterialIcon, { icon: 'check_circle', size: 24 })`
  color: var(--theme-success);
`

const UnverifiedIcon = styledWithAttrs(MaterialIcon, { icon: 'error', size: 24 })`
  color: var(--theme-amber);
`

const CurrentUserFragment = graphql(/* GraphQL */ `
  fragment AccountSettings_CurrentUser on CurrentUser {
    id
    name
    loginName
    email
    emailVerified
    lastLoginNameChange
    lastNameChange
    nameChangeTokens
    canChangeDisplayName
    nextDisplayNameChangeAllowedAt
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
  const [{ data }, refreshQuery] = useQuery({
    query: AccountSettingsQuery,
  })
  const currentUser = useFragment(CurrentUserFragment, data?.currentUser)
  const [emailRevealed, setEmailRevealed] = useState(false)
  const reduxEmailVerified = useSelfUser()?.emailVerified

  useEffect(() => {
    if (currentUser && reduxEmailVerified !== currentUser.emailVerified) {
      // Refresh the user information from gql since it's out of date from what the redux store has
      refreshQuery({ requestPolicy: 'network-only' })
    }
  }, [refreshQuery, reduxEmailVerified, currentUser])

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
    const numStars = Math.min(Math.max(6, lastAt), 10)
    emailText = '*'.repeat(numStars) + emailText.slice(lastAt)
  }

  return (
    <Root>
      <Section>
        <UserCard>
          <EditableItem>
            <EditableContent>
              <EditableOverline>
                {t('settings.user.account.displayName', 'Display name')}
              </EditableOverline>
              <TitleMedium>{currentUser.name}</TitleMedium>
            </EditableContent>
            <FilledButton
              label={t('common.actions.edit', 'Edit')}
              onClick={() => {
                dispatch(
                  openDialog({
                    type: DialogType.ChangeDisplayName,
                    initData: {
                      currentName: currentUser.name ?? '',
                      lastChange: currentUser.lastNameChange
                        ? new Date(currentUser.lastNameChange)
                        : undefined,
                      canChangeDisplayName: currentUser.canChangeDisplayName ?? false,
                      nextDisplayNameChangeAllowedAt: currentUser.nextDisplayNameChangeAllowedAt
                        ? new Date(currentUser.nextDisplayNameChangeAllowedAt)
                        : undefined,
                    },
                  }),
                )
              }}
              testName='edit-display-name-button'
            />
          </EditableItem>

          <EditableItem>
            <EditableContent>
              <EditableOverline>
                {t('settings.user.account.loginName', 'Login name')}
              </EditableOverline>
              <TitleMedium>{currentUser.loginName}</TitleMedium>
            </EditableContent>
            <FilledButton
              label={t('common.actions.edit', 'Edit')}
              onClick={() => {
                dispatch(
                  openDialog({
                    type: DialogType.ChangeLoginName,
                    initData: {
                      currentLoginName: currentUser.loginName ?? '',
                      lastChange: currentUser.lastLoginNameChange
                        ? new Date(currentUser.lastLoginNameChange)
                        : undefined,
                    },
                  }),
                )
              }}
              testName='edit-login-name-button'
            />
          </EditableItem>

          <EditableItem>
            <EditableContent>
              <EditableOverline>{t('settings.user.account.email', 'Email')}</EditableOverline>

              <EmailItemAndIcon>
                {currentUser.emailVerified ? (
                  <Tooltip
                    text={t('settings.user.account.emailVerified', 'Verified')}
                    position='bottom'>
                    <VerifiedIcon data-test='email-verified-icon' />
                  </Tooltip>
                ) : (
                  <Tooltip
                    text={t('settings.user.account.emailUnverified', 'Unverified')}
                    position='bottom'>
                    <UnverifiedIcon data-test='email-unverified-icon' />
                  </Tooltip>
                )}
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
              </EmailItemAndIcon>
            </EditableContent>
            <MultiButtons>
              {!currentUser.emailVerified ? (
                <FilledButton
                  label={t('auth.emailVerification.verify', 'Verify')}
                  testName='verify-email-button'
                  onClick={() => {
                    dispatch(
                      openDialog({
                        type: DialogType.EmailVerification,
                      }),
                    )
                  }}
                />
              ) : null}
              <FilledButton
                label={t('common.actions.edit', 'Edit')}
                onClick={() => {
                  dispatch(
                    openDialog({
                      type: DialogType.ChangeEmail,
                      initData: { currentEmail: currentUser?.email ?? '' },
                    }),
                  )
                }}
                testName='edit-email-button'
              />
            </MultiButtons>
          </EditableItem>
        </UserCard>
      </Section>

      <Section>
        <SectionHeader>
          {t('settings.user.account.authenticationHeader', 'Authentication')}
        </SectionHeader>
        <FilledButton
          label={t('settings.user.account.changePasswordButton', 'Change password')}
          onClick={() => {
            dispatch(
              openDialog({
                type: DialogType.ChangePassword,
              }),
            )
          }}
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
  color: var(--theme-error);
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
    userUpdateCurrent(currentPassword: $currentPassword, changes: { newPassword: $newPassword }) {
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
  const snackbarController = useSnackbarController()
  const { t } = useTranslation()
  const [{ fetching }, changePassword] = useMutation(ChangePasswordMutation)
  const [errorMessage, setErrorMessage] = useState<string>()
  const autoFocusRef = useAutoFocusRef<HTMLInputElement>()

  const { onCancel } = props

  const { submit, bindInput, setInputError, form } = useForm<ChangePasswordFormModel>(
    { currentPassword: '', newPassword: '', confirmNewPassword: '' },
    {
      currentPassword: currentPasswordValidator,
      newPassword: newPasswordValidator,
      confirmNewPassword: confirmNewPasswordValidator,
    },
  )

  useFormCallbacks(form, {
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
            snackbarController.showSnackbar(
              t('settings.user.account.changePassword.success', 'Password changed successfully.'),
            )
            onCancel()
          }
        })
        .catch(err => {
          logger.error(`Error changing password: ${err.stack ?? err}`)
        })
    },
  })

  const buttons = [
    <TextButton
      label={t('common.actions.cancel', 'Cancel')}
      key='cancel'
      onClick={onCancel}
      disabled={fetching}
    />,
    <TextButton
      label={t('common.actions.save', 'Save')}
      key='save'
      onClick={submit}
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
      testName='change-password-dialog'>
      {errorMessage ? <ErrorMessage>{errorMessage}</ErrorMessage> : null}
      <form noValidate={true} onSubmit={submit}>
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
    userUpdateCurrent(currentPassword: $currentPassword, changes: { email: $email }) {
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
  const snackbarController = useSnackbarController()
  const { t } = useTranslation()
  const [{ fetching }, changeEmail] = useMutation(ChangeEmailMutation)
  const [errorMessage, setErrorMessage] = useState<string>()
  const autoFocusRef = useAutoFocusRef<HTMLInputElement>()

  const { onCancel } = props

  const { submit, bindInput, setInputError, form } = useForm<ChangeEmailFormModel>(
    { currentPassword: '', email: props.currentEmail },
    {
      currentPassword: currentPasswordValidator,
      email: emailValidator,
    },
  )

  useFormCallbacks(form, {
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
            snackbarController.showSnackbar(
              t('settings.user.account.changeEmail.success', 'Email changed successfully.'),
            )
            onCancel()
          }
        })
        .catch(err => {
          logger.error(`Error changing password: ${err.stack ?? err}`)
        })
    },
  })

  const buttons = [
    <TextButton
      label={t('common.actions.cancel', 'Cancel')}
      key='cancel'
      onClick={onCancel}
      disabled={fetching}
    />,
    <TextButton
      label={t('common.actions.save', 'Save')}
      key='save'
      onClick={submit}
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
      testName='change-email-dialog'>
      {errorMessage ? <ErrorMessage>{errorMessage}</ErrorMessage> : null}
      <form noValidate={true} onSubmit={submit}>
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

const ChangeDisplayNameMutation = graphql(/* GraphQL */ `
  mutation AccountSettingsChangeDisplayName($currentPassword: String!, $name: String!) {
    userUpdateCurrent(currentPassword: $currentPassword, changes: { name: $name }) {
      ...AccountSettings_CurrentUser
    }
  }
`)

interface ChangeDisplayNameFormModel {
  currentPassword: string
  name: string
}

export interface ChangeDisplayNameDialogProps extends CommonDialogProps {
  currentName: string
  lastChange?: Date
  canChangeDisplayName: boolean
  nextDisplayNameChangeAllowedAt?: Date
}

export function ChangeDisplayNameDialog({
  onCancel,
  currentName,
  canChangeDisplayName,
  nextDisplayNameChangeAllowedAt,
}: ChangeDisplayNameDialogProps) {
  const dispatch = useAppDispatch()
  const snackbarController = useSnackbarController()
  const { t } = useTranslation()
  const [{ fetching }, changeDisplayName] = useMutation(ChangeDisplayNameMutation)
  const [errorMessage, setErrorMessage] = useState<string>()
  const autoFocusRef = useAutoFocusRef<HTMLInputElement>()

  const nameAvailable = useMemo(
    () =>
      createUsernameAvailabilityValidator<ChangeDisplayNameFormModel>({
        type: 'display',
        ignoreName: currentName,
      }),
    [currentName],
  )

  const { submit, bindInput, setInputError, form } = useForm<ChangeDisplayNameFormModel>(
    { currentPassword: '', name: currentName },
    {
      currentPassword: currentPasswordValidator,
      name: composeValidators(usernameValidator, nameAvailable),
    },
  )

  const daysRemaining =
    nextDisplayNameChangeAllowedAt && !canChangeDisplayName
      ? Math.max(
          0,
          Math.ceil((Number(nextDisplayNameChangeAllowedAt) - Date.now()) / (24 * 60 * 60 * 1000)),
        )
      : 0

  useFormCallbacks(form, {
    onSubmit: model => {
      setErrorMessage(undefined)
      changeDisplayName({
        currentPassword: model.currentPassword,
        name: model.name,
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
                if (error.extensions?.code === 'INVALID_PASSWORD') {
                  setInputError(
                    'currentPassword',
                    t(
                      'settings.user.account.invalidCurrentPassword',
                      'Current password is incorrect',
                    ),
                  )
                  return
                } else if (error.extensions?.code === 'DISPLAY_NAME_UNAVAILABLE') {
                  setInputError(
                    'name',
                    t(
                      'settings.user.account.displayNameUnavailable',
                      'Display name is not available',
                    ),
                  )
                  return
                } else if (error.extensions?.code === 'RATE_LIMITED') {
                  setErrorMessage(error.message)
                  setErrorMessage(
                    t(
                      'settings.user.account.displayNameCooldown',
                      'You have changed your display name too recently. You can change your ' +
                        'display name again in {{count}} days.',
                      { count: daysRemaining },
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
            snackbarController.showSnackbar(
              t(
                'settings.user.account.changeDisplayName.success',
                'Display name changed successfully.',
              ),
            )
            onCancel()
            dispatch({
              type: '@auth/displayNameChanged',
              payload: {
                newDisplayName: model.name,
              },
            })
          }
        })
        .catch(err => {
          logger.error(`Error changing display name: ${getErrorStack(err)}`)
        })
    },
  })

  const buttons = [
    <TextButton
      label={t('common.actions.cancel', 'Cancel')}
      key='cancel'
      onClick={onCancel}
      disabled={fetching}
    />,
    <TextButton
      label={t('common.actions.save', 'Save')}
      key='save'
      onClick={submit}
      disabled={fetching}
      testName='save-button'
    />,
  ]

  return (
    <StyledDialog
      title={t('settings.user.account.changeDisplayName.dialogTitle', 'Change display name')}
      onCancel={onCancel}
      showCloseButton={true}
      buttons={buttons}
      testName='change-display-name-dialog'>
      <BodyMedium>
        {t(
          'settings.user.account.displayNameChangeInfo',
          'Display names can be changed once every 60 days. Capitalization changes are not ' +
            'affected by name change limits.',
        )}
      </BodyMedium>
      <FormSpacer />

      {errorMessage ? (
        <>
          <ErrorMessage>{errorMessage}</ErrorMessage>
          <FormSpacer />
        </>
      ) : null}
      {!fetching && !errorMessage && !canChangeDisplayName && daysRemaining ? (
        <>
          <ErrorMessage>
            {t(
              'settings.user.account.displayNameCooldown',
              'You have changed your display name too recently. You can change your display name ' +
                'again in {{count}} days.',
              { count: daysRemaining },
            )}
          </ErrorMessage>
          <FormSpacer />
        </>
      ) : null}
      <form noValidate={true} onSubmit={submit}>
        <SubmitOnEnter disabled={fetching} />
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
          {...bindInput('name')}
          label={t('settings.user.account.displayName', 'Display name')}
          inputProps={TEXT_INPUT_PROPS}
          floatingLabel={true}
          disabled={fetching}
        />
      </form>
    </StyledDialog>
  )
}

const ChangeLoginNameMutation = graphql(/* GraphQL */ `
  mutation AccountSettingsChangeLoginName($currentPassword: String!, $loginName: String!) {
    userUpdateCurrent(currentPassword: $currentPassword, changes: { loginName: $loginName }) {
      ...AccountSettings_CurrentUser
    }
  }
`)

interface ChangeLoginNameFormModel {
  currentPassword: string
  loginName: string
}

export interface ChangeLoginNameDialogProps extends CommonDialogProps {
  currentLoginName: string
  lastChange?: Date
}

export function ChangeLoginNameDialog(props: ChangeLoginNameDialogProps) {
  const snackbarController = useSnackbarController()
  const { t } = useTranslation()
  const [{ fetching }, changeLoginName] = useMutation(ChangeLoginNameMutation)
  const [errorMessage, setErrorMessage] = useState<string>()
  const autoFocusRef = useAutoFocusRef<HTMLInputElement>()

  const { onCancel, lastChange } = props

  const isChangeAllowed =
    !lastChange || Date.now() - Number(lastChange) >= LOGIN_NAME_CHANGE_COOLDOWN_MS
  const daysRemaining = lastChange
    ? Math.max(
        0,
        Math.ceil(
          (LOGIN_NAME_CHANGE_COOLDOWN_MS - (Date.now() - Number(lastChange))) /
            (24 * 60 * 60 * 1000),
        ),
      )
    : 0

  const nameAvailable = useMemo(
    () => createUsernameAvailabilityValidator<ChangeLoginNameFormModel>({ type: 'login' }),
    [],
  )

  const { submit, bindInput, setInputError, form } = useForm<ChangeLoginNameFormModel>(
    { currentPassword: '', loginName: props.currentLoginName },
    {
      currentPassword: currentPasswordValidator,
      loginName: composeValidators(usernameValidator, nameAvailable),
    },
  )

  useFormCallbacks(form, {
    onSubmit: model => {
      setErrorMessage(undefined)
      changeLoginName({
        currentPassword: model.currentPassword,
        loginName: model.loginName,
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
                if (error.extensions?.code === 'INVALID_PASSWORD') {
                  setInputError(
                    'currentPassword',
                    t(
                      'settings.user.account.invalidCurrentPassword',
                      'Current password is incorrect',
                    ),
                  )
                  return
                } else if (error.extensions?.code === 'LOGIN_NAME_UNAVAILABLE') {
                  setInputError(
                    'loginName',
                    t('settings.user.account.loginNameUnavailable', 'Login name is not available'),
                  )
                  return
                } else if (error.extensions?.code === 'RATE_LIMITED') {
                  setErrorMessage(
                    t(
                      'settings.user.account.rateLimited',
                      'You can only change your login name once every 30 days.',
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
            snackbarController.showSnackbar(
              t(
                'settings.user.account.changeLoginName.success',
                'Login name changed successfully.',
              ),
            )
            onCancel()
          }
        })
        .catch(err => {
          logger.error(`Error changing login name: ${getErrorStack(err)}`)
        })
    },
  })

  const buttons = [
    <TextButton
      label={t('common.actions.cancel', 'Cancel')}
      key='cancel'
      onClick={onCancel}
      disabled={fetching}
    />,
    <TextButton
      label={t('common.actions.save', 'Save')}
      key='save'
      onClick={submit}
      disabled={fetching}
      testName='save-button'
    />,
  ]

  return (
    <StyledDialog
      title={t('settings.user.account.changeLoginName.dialogTitle', 'Change login name')}
      onCancel={onCancel}
      showCloseButton={true}
      buttons={buttons}
      testName='change-login-name-dialog'>
      <BodyMedium>
        {t(
          'settings.user.account.loginNameChangeInfo',
          'Login names can be changed once every 30 days.',
        )}
      </BodyMedium>
      <FormSpacer />

      {errorMessage ? (
        <>
          <ErrorMessage>{errorMessage}</ErrorMessage>
          <FormSpacer />
        </>
      ) : null}
      {!errorMessage && !isChangeAllowed && daysRemaining ? (
        <>
          <ErrorMessage>
            {t(
              'settings.user.account.loginNameCooldown',
              'You have changed your name too recently. You can change your login name again in ' +
                '{{count}} days.',
              { count: daysRemaining },
            )}
          </ErrorMessage>
          <FormSpacer />
        </>
      ) : null}
      <form noValidate={true} onSubmit={submit}>
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
          {...bindInput('loginName')}
          label={t('settings.user.account.loginName', 'Login name')}
          inputProps={TEXT_INPUT_PROPS}
          floatingLabel={true}
          disabled={fetching}
        />
      </form>
    </StyledDialog>
  )
}
