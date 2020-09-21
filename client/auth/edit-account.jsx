import React from 'react'
import { connect } from 'react-redux'
import styled from 'styled-components'

import Avatar from '../avatars/avatar.jsx'
import Dialog from '../material/dialog.jsx'
import FlatButton from '../material/flat-button.jsx'
import form from '../forms/form.jsx'
import LoadingIndicator from '../progress/dots.jsx'
import PasswordTextField from '../material/password-text-field.jsx'
import SubmitOnEnter from '../forms/submit-on-enter.jsx'

import { closeDialog } from '../dialogs/action-creators'
import { updateAccount } from '../auth/auther'
import { composeValidators, matchesOther, minLength, required } from '../forms/validators'
import { PASSWORD_MINLENGTH } from '../../common/constants'

import { colorError } from '../styles/colors'
import { Subheading } from '../styles/typography'

const passwordValidator = composeValidators(
  required('Enter a password'),
  minLength(PASSWORD_MINLENGTH, `Enter at least ${PASSWORD_MINLENGTH} characters`),
)
const newPasswordValidator = composeValidators(
  required('Enter a new password'),
  minLength(PASSWORD_MINLENGTH, `Enter at least ${PASSWORD_MINLENGTH} characters`),
)
const confirmNewPasswordValidator = composeValidators(
  required('Confirm your new password'),
  matchesOther('newPassword', 'Enter a matching password'),
)

@form({
  currentPassword: passwordValidator,
  newPassword: newPasswordValidator,
  confirmNewPassword: confirmNewPasswordValidator,
})
class AccountForm extends React.Component {
  render() {
    const { bindInput, onSubmit } = this.props
    const textInputProps = {
      autoCapitalize: 'off',
      autoCorrect: 'off',
      spellCheck: false,
      tabIndex: 1,
    }

    return (
      <form noValidate={true} onSubmit={onSubmit}>
        <SubmitOnEnter />
        <PasswordTextField
          {...bindInput('currentPassword')}
          label='Current password'
          floatingLabel={true}
          inputProps={textInputProps}
        />
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
      </form>
    )
  }
}

const LoadingArea = styled.div`
  display: flex;
  justify-content: center;
  align-items: center;
  margin-bottom: 24px;
`

const ErrorText = styled(Subheading)`
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

  renderDialogContents() {
    const { auth } = this.props

    return (
      <AccountContainer>
        <StyledAvatar user={auth.user.name} />
        <InfoContainer>
          <AccountForm ref={this._form} model={{}} onSubmit={this.onSubmit} />
        </InfoContainer>
      </AccountContainer>
    )
  }

  render() {
    const { auth, onCancel } = this.props
    const { reqId } = this.state
    let loadingElem
    let errorElem

    if (auth.authChangeInProgress) {
      loadingElem = (
        <LoadingArea>
          <LoadingIndicator />
        </LoadingArea>
      )
    }

    if (reqId && auth.lastFailure && auth.lastFailure.reqId === reqId) {
      errorElem = (
        <ErrorText>
          There was an issue with updating your account. Please check your data and try again.
        </ErrorText>
      )
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
        {this.renderDialogContents()}
      </Dialog>
    )
  }

  onAccountSave = () => {
    this._form.current.submit()
  }

  onSubmit = () => {
    const values = this._form.current.getModel()
    const userProps = {
      currentPassword: values.currentPassword,
      newPassword: values.newPassword,
    }

    const { id, action } = updateAccount(this.props.auth.user.id, userProps)
    this.setState({ reqId: id })
    this.props.dispatch(action)
  }
}
