import React from 'react'
import PropTypes from 'prop-types'
import { connect } from 'react-redux'
import styled from 'styled-components'

import Avatar from '../avatars/avatar.jsx'
import Dialog from '../material/dialog.jsx'
import FlatButton from '../material/flat-button.jsx'
import form from '../forms/form.jsx'
import { Label } from '../material/button.jsx'
import LoadingIndicator from '../progress/dots.jsx'
import PasswordTextField from '../material/password-text-field.jsx'
import SubmitOnEnter from '../forms/submit-on-enter.jsx'
import TextField from '../material/text-field.jsx'

import { closeDialog } from '../dialogs/action-creators'
import { updateAccount } from './action-creators'
import {
  composeValidators,
  matchesOther,
  minLength,
  maxLength,
  regex,
  required,
} from '../forms/validators'
import {
  EMAIL_MINLENGTH,
  EMAIL_MAXLENGTH,
  EMAIL_PATTERN,
  PASSWORD_MINLENGTH,
} from '../../common/constants'

import { colorTextSecondary, colorError } from '../styles/colors'
import { SubheadingOld } from '../styles/typography'

function passwordRequired() {
  return (val, model, dirty) =>
    (dirty.email || dirty.newPassword) && !val ? 'Enter your current password' : null
}

const emailValidator = composeValidators(
  required('Enter an email address'),
  minLength(EMAIL_MINLENGTH, `Use at least ${EMAIL_MINLENGTH} characters`),
  maxLength(EMAIL_MAXLENGTH, `Use at most ${EMAIL_MAXLENGTH} characters`),
  regex(EMAIL_PATTERN, 'Enter a valid email address'),
)
const passwordValidator = composeValidators(
  passwordRequired(),
  minLength(PASSWORD_MINLENGTH, `Enter at least ${PASSWORD_MINLENGTH} characters`),
)
const newPasswordValidator = composeValidators(
  minLength(PASSWORD_MINLENGTH, `Enter at least ${PASSWORD_MINLENGTH} characters`),
)
const confirmNewPasswordValidator = composeValidators(
  matchesOther('newPassword', 'Enter a matching password'),
)

const ChangePasswordButton = styled(FlatButton)`
  & ${Label} {
    color: ${colorTextSecondary};
    font-weight: 400;
  }
`

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
          label='Email'
          floatingLabel={true}
        />
        <PasswordTextField
          {...bindInput('currentPassword')}
          label='Current password'
          floatingLabel={true}
          inputProps={textInputProps}
        />
        {!changePassword ? (
          <ChangePasswordButton
            label='Change password?'
            onClick={this.onPasswordChangeClick}
            tabIndex={0}
          />
        ) : (
          <>
            <PasswordTextField
              {...bindInput('newPassword')}
              label='New password'
              floatingLabel={true}
              inputProps={textInputProps}
            />
            <PasswordTextField
              {...bindInput('confirmNewPassword')}
              label='Confirm new password'
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

const ErrorText = styled(SubheadingOld)`
  margin: 0;
  margin-bottom: 24px;
  color: ${colorError};
`

const AccountContainer = styled.div`
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
      this.props.dispatch(closeDialog())
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
    const { auth, onCancel } = this.props
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
        passwordError = 'Incorrect current password.'
      } else {
        errorElem = (
          <ErrorText>There was an issue updating your account. Please try again later.</ErrorText>
        )
      }
    }

    const buttons = [
      <FlatButton label='Cancel' key='cancel' color='accent' onClick={onCancel} />,
      <FlatButton
        ref={this._saveButton}
        label='Save'
        key='save'
        color='accent'
        onClick={this.onAccountSave}
      />,
    ]

    return (
      <Dialog title={'Edit account'} buttons={buttons} showCloseButton={true} onCancel={onCancel}>
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
      this.props.dispatch(closeDialog())
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
