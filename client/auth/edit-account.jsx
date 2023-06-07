import PropTypes from 'prop-types'
import React from 'react'
import { connect } from 'react-redux'
import styled from 'styled-components'
import {
  EMAIL_MAXLENGTH,
  EMAIL_MINLENGTH,
  EMAIL_PATTERN,
  PASSWORD_MINLENGTH,
} from '../../common/constants'
import { Avatar } from '../avatars/avatar'
import { closeDialog } from '../dialogs/action-creators'
import { DialogType } from '../dialogs/dialog-type'
import form from '../forms/form'
import SubmitOnEnter from '../forms/submit-on-enter'
import {
  composeValidators,
  matchesOther,
  maxLength,
  minLength,
  regex,
  required,
} from '../forms/validators'
import { TextButton } from '../material/button'
import { Dialog } from '../material/dialog'
import { PasswordTextField } from '../material/password-text-field'
import { TextField } from '../material/text-field'
import LoadingIndicator from '../progress/dots'
import { colorError } from '../styles/colors'
import { subtitle1 } from '../styles/typography'
import { updateAccount } from './action-creators'

// TODO(2Pac): Use the `useTranslation` hook once this is moved over to a functional component. Note
// that I'm using the global version of the `t` function here. react-i18next also exposes a HOC that
// can be used with class components to make the `t` function reactive, but making that work with
// form validators here would be quite cumbersome, so this seemed easier until it gets replaced with
// hooks.
import i18n from '../i18n/i18next'
const t = i18n.t

function passwordRequired() {
  return (val, model, dirty) =>
    (dirty.email || dirty.newPassword) && !val
      ? t('auth.passwordValidator.current', 'Enter your current password')
      : null
}

const emailValidator = composeValidators(
  required(t('auth.emailValidator.required', 'Enter an email address')),
  minLength(
    EMAIL_MINLENGTH,
    t('common.validators.minLength', {
      defaultValue: `Enter at least {{minLength}} characters`,
      minLength: EMAIL_MINLENGTH,
    }),
  ),
  maxLength(
    EMAIL_MAXLENGTH,
    t('common.validators.maxLength', {
      defaultValue: `Enter at most {{maxLength}} characters`,
      maxLength: EMAIL_MAXLENGTH,
    }),
  ),
  regex(EMAIL_PATTERN, t('auth.emailValidator.pattern', 'Enter a valid email address')),
)
const passwordValidator = composeValidators(
  passwordRequired(),
  minLength(
    PASSWORD_MINLENGTH,
    t('common.validators.minLength', {
      defaultValue: `Enter at least {{minLength}} characters`,
      minLength: PASSWORD_MINLENGTH,
    }),
  ),
)
const newPasswordValidator = composeValidators(
  minLength(
    PASSWORD_MINLENGTH,
    t('common.validators.minLength', {
      defaultValue: `Enter at least {{minLength}} characters`,
      minLength: PASSWORD_MINLENGTH,
    }),
  ),
)
const confirmNewPasswordValidator = composeValidators(
  matchesOther('newPassword', t('auth.passwordValidator.matching', 'Enter a matching password')),
)

@form({
  email: emailValidator,
  currentPassword: passwordValidator,
  newPassword: newPasswordValidator,
  confirmNewPassword: confirmNewPasswordValidator,
})
class AccountForm extends React.Component {
  static propTypes = {
    passwordError: PropTypes.string,
  }

  state = {
    changePassword: false,
  }

  componentDidUpdate(prevProps) {
    if (prevProps.passwordError !== this.props.passwordError && this.props.passwordError) {
      this.props.setInputError('currentPassword', this.props.passwordError)
    }
  }

  render() {
    const { bindInput, onSubmit } = this.props
    const { changePassword } = this.state
    const textInputProps = {
      autoCapitalize: 'off',
      autoCorrect: 'off',
      spellCheck: false,
      tabIndex: 0,
    }

    return (
      <form noValidate={true} onSubmit={onSubmit}>
        <SubmitOnEnter />
        <TextField
          {...bindInput('email')}
          inputProps={textInputProps}
          label={t('auth.editAccount.email', 'Email')}
          floatingLabel={true}
        />
        <PasswordTextField
          {...bindInput('currentPassword')}
          label={t('auth.editAccount.currentPassword', 'Current password')}
          floatingLabel={true}
          inputProps={textInputProps}
        />
        {!changePassword ? (
          <TextButton
            label={t('auth.editAccount.changePassword', 'Change password?')}
            onClick={this.onPasswordChangeClick}
            tabIndex={0}
          />
        ) : (
          <>
            <PasswordTextField
              {...bindInput('newPassword')}
              label={t('auth.editAccount.newPassword', 'New password')}
              floatingLabel={true}
              inputProps={textInputProps}
            />
            <PasswordTextField
              {...bindInput('confirmNewPassword')}
              label={t('auth.editAccount.confirmNewPassword', 'Confirm new password')}
              floatingLabel={true}
              inputProps={textInputProps}
            />
          </>
        )}
      </form>
    )
  }

  onPasswordChangeClick = () => {
    this.setState({ changePassword: true })
  }
}

const LoadingArea = styled.div`
  display: flex;
  justify-content: center;
  align-items: center;
  margin-bottom: 24px;
`

const ErrorText = styled.div`
  ${subtitle1};
  margin: 0;
  margin-bottom: 24px;
  color: ${colorError};
`

const AccountContainer = styled.div`
  margin-top: 16px;
  display: flex;
  align-items: flex-start;
`

const StyledAvatar = styled(Avatar)`
  flex-shrink: 0;
  width: 128px;
  height: 128px;
  margin-right: 16px;
`

const InfoContainer = styled.div`
  flex-grow: 1;
  display: flex;
  flex-direction: column;
`

@connect(state => ({ auth: state.auth }))
export default class EditAccount extends React.Component {
  state = {
    reqId: null,
  }

  _form = React.createRef()

  componentDidUpdate(prevProps) {
    const isPrevRequesting = prevProps.auth.authChangeInProgress
    const isRequesting = this.props.auth.authChangeInProgress
    const hasError = !!this.props.auth.lastFailure

    if (isPrevRequesting && !isRequesting && !hasError) {
      this.props.dispatch(closeDialog(DialogType.Account))
    }
  }

  renderDialogContents(passwordError) {
    const { auth } = this.props
    const formModel = {
      email: auth.user.email,
    }

    return (
      <AccountContainer>
        <StyledAvatar user={auth.user.name} />
        <InfoContainer>
          <AccountForm
            ref={this._form}
            model={formModel}
            passwordError={passwordError}
            onSubmit={this.onSubmit}
          />
        </InfoContainer>
      </AccountContainer>
    )
  }

  render() {
    const { auth, onCancel, dialogRef } = this.props
    const { reqId } = this.state
    let loadingElem
    let errorElem
    let passwordError

    if (auth.authChangeInProgress) {
      loadingElem = (
        <LoadingArea>
          <LoadingIndicator />
        </LoadingArea>
      )
    }

    if (reqId && auth.lastFailure && auth.lastFailure.reqId === reqId) {
      // TODO(2Pac): Use the actual error code once the error system is implemented.
      if (auth.lastFailure.err === 'Incorrect password') {
        passwordError = t('auth.editAccount.incorrectPassword', 'Incorrect current password.')
      } else {
        errorElem = (
          <ErrorText>
            {t(
              'auth.editAccount.errorUpdatingAccount',
              'There was an issue updating your account. Please try again later.',
            )}
          </ErrorText>
        )
      }
    }

    const buttons = [
      <TextButton
        label={t('common.actions.cancel', 'Cancel')}
        key='cancel'
        color='accent'
        onClick={onCancel}
      />,
      <TextButton
        ref={this._saveButton}
        label={t('common.actions.save', 'Save')}
        key='save'
        color='accent'
        onClick={this.onAccountSave}
      />,
    ]

    return (
      <Dialog
        title={t('auth.editAccount.dialogTitle', 'Edit account')}
        buttons={buttons}
        showCloseButton={true}
        onCancel={onCancel}
        dialogRef={dialogRef}>
        {loadingElem}
        {errorElem}
        {this.renderDialogContents(passwordError)}
      </Dialog>
    )
  }

  onAccountSave = () => {
    this._form.current.submit()
  }

  onSubmit = () => {
    const oldValues = this.props.auth.user
    const values = this._form.current.getModel()
    const userProps = {
      currentPassword: values.currentPassword,
      newPassword: values.newPassword,
    }

    if (oldValues.email === values.email && !values.newPassword) {
      // Nothing changed, just close the dialog.
      this.props.dispatch(closeDialog(DialogType.Account))
      return
    }
    if (oldValues.email !== values.email) {
      userProps.newEmail = values.email
    }

    const { id, action } = updateAccount(this.props.auth.user.id, userProps)
    this.setState({ reqId: id })
    this.props.dispatch(action)
  }
}
