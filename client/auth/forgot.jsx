import PropTypes from 'prop-types'
import queryString from 'query-string'
import React from 'react'
import { connect } from 'react-redux'
import {
  EMAIL_MAXLENGTH,
  EMAIL_MINLENGTH,
  EMAIL_PATTERN,
  PASSWORD_MINLENGTH,
  USERNAME_MAXLENGTH,
  USERNAME_MINLENGTH,
  USERNAME_PATTERN,
} from '../../common/constants'
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
import RaisedButton from '../material/raised-button'
import { push } from '../navigation/routing'
import LoadingIndicator from '../progress/dots'
import { recoverUsername, resetPassword, startPasswordReset } from './action-creators'
import {
  AuthBody,
  AuthBottomAction,
  AuthContent,
  AuthContentContainer,
  AuthPasswordTextField,
  AuthTextField,
  AuthTitle,
  BottomActionButton,
  ErrorsContainer,
  FieldRow,
  LoadingArea,
  SuccessContainer,
} from './auth-content'

const emailValidator = composeValidators(
  required('Enter an email address'),
  minLength(EMAIL_MINLENGTH, `Use at least ${EMAIL_MINLENGTH} characters`),
  maxLength(EMAIL_MAXLENGTH, `Use at most ${EMAIL_MAXLENGTH} characters`),
  regex(EMAIL_PATTERN, 'Enter a valid email address'),
)
const usernameValidator = composeValidators(
  required('Enter a username'),
  minLength(USERNAME_MINLENGTH, `Enter at least ${USERNAME_MINLENGTH} characters`),
  maxLength(USERNAME_MAXLENGTH, `Enter at most ${USERNAME_MAXLENGTH} characters`),
  regex(USERNAME_PATTERN, 'Username contains invalid characters'),
)

@connect(state => ({ auth: state.auth }))
class ForgotFormHolder extends React.Component {
  static propTypes = {
    // The Form component class to render
    form: PropTypes.func.isRequired,
    title: PropTypes.string.isRequired,
    model: PropTypes.object,
    doSubmit: PropTypes.func.isRequired,
    successMessage: PropTypes.string,
  }

  state = {
    reqId: null,
    success: false,
  }
  _form = null
  _setForm = elem => {
    this._form = elem
  }

  componentDidUpdate(prevProps) {
    if (prevProps.auth.authChangeInProgress && !this.props.auth.authChangeInProgress) {
      if (this.state.reqId && !this.props.auth.lastFailure) {
        this._form.reset()
        this.setState({ success: true })
      }
    }
  }

  render() {
    const {
      auth: { authChangeInProgress, lastFailure },
      form: FormComponent,
      model,
      title,
      successMessage,
    } = this.props
    let loadingContents
    if (authChangeInProgress) {
      loadingContents = (
        <LoadingArea>
          <LoadingIndicator />
        </LoadingArea>
      )
    }
    let errContents
    const reqId = this.state.reqId
    if (reqId && lastFailure && lastFailure.reqId === reqId) {
      errContents = <ErrorsContainer>Error: {lastFailure.err}</ErrorsContainer>
    }
    const successContents =
      this.state.success && successMessage ? (
        <SuccessContainer>{successMessage}</SuccessContainer>
      ) : null

    return (
      <AuthContent>
        <AuthContentContainer isLoading={authChangeInProgress}>
          <AuthTitle as='h3'>{title}</AuthTitle>
          <AuthBody>
            {errContents}
            {successContents}
            <FormComponent ref={this._setForm} model={model || {}} onSubmit={this.onSubmit} />
          </AuthBody>
        </AuthContentContainer>
        {loadingContents}
        <AuthBottomAction>
          <BottomActionButton label='Back to login' onClick={this.onBackClick} tabIndex={1} />
        </AuthBottomAction>
      </AuthContent>
    )
  }

  onBackClick = () => {
    push({ pathname: '/login' })
  }

  onSubmit = () => {
    const values = this._form.getModel()
    const { id, action } = this.props.doSubmit(values)
    this.setState({
      reqId: id,
      success: false,
    })
    this.props.dispatch(action)
  }
}

@form({
  email: emailValidator,
})
class ForgotUserForm extends React.Component {
  render() {
    const { onSubmit, bindInput } = this.props
    return (
      <form noValidate={true} onSubmit={onSubmit}>
        <SubmitOnEnter />
        <p>Please enter the email address you signed up with.</p>
        <FieldRow>
          <AuthTextField
            {...bindInput('email')}
            label='Email address'
            floatingLabel={true}
            inputProps={{
              tabIndex: 1,
              autoCapitalize: 'off',
              autoCorrect: 'off',
              spellCheck: false,
            }}
          />
        </FieldRow>
        <FieldRow>
          <RaisedButton label='Recover username' onClick={onSubmit} tabIndex={1} />
        </FieldRow>
      </form>
    )
  }
}

const FORGOT_USER_SUCCESS =
  'If there are any users registered to that email address, you should ' +
  'receive an email in the next few minutes with the relevant usernames.'
const doForgotUserSubmit = values => recoverUsername(values.email)
export const ForgotUser = () => (
  <ForgotFormHolder
    form={ForgotUserForm}
    title={'Recover your username'}
    doSubmit={doForgotUserSubmit}
    successMessage={FORGOT_USER_SUCCESS}
  />
)

@form({
  email: emailValidator,
  username: usernameValidator,
})
class ForgotPasswordForm extends React.Component {
  render() {
    const { onSubmit, bindInput } = this.props
    return (
      <form noValidate={true} onSubmit={onSubmit}>
        <SubmitOnEnter />
        <FieldRow>
          <AuthTextField
            {...bindInput('email')}
            label='Email address'
            floatingLabel={true}
            inputProps={{
              tabIndex: 1,
              autoCapitalize: 'off',
              autoCorrect: 'off',
              spellCheck: false,
            }}
          />
        </FieldRow>
        <FieldRow>
          <AuthTextField
            {...bindInput('username')}
            label='Username'
            floatingLabel={true}
            inputProps={{
              tabIndex: 1,
              autoCapitalize: 'off',
              autoCorrect: 'off',
              spellCheck: false,
            }}
          />
        </FieldRow>
        <FieldRow>
          <RaisedButton label='Send reset email' onClick={onSubmit} tabIndex={1} />
        </FieldRow>
      </form>
    )
  }
}

const FORGOT_PASSWORD_SUCCESS =
  'If that email address and username match a registered account, ' +
  'you should receive an email in the next few minutes with instructions on how to reset ' +
  'your password.'
const doPasswordResetStart = values => startPasswordReset(values.username, values.email)
export const ForgotPassword = () => (
  <ForgotFormHolder
    form={ForgotPasswordForm}
    title={'Reset password'}
    doSubmit={doPasswordResetStart}
    successMessage={FORGOT_PASSWORD_SUCCESS}
  />
)

const tokenValidator = required('Enter your password reset code')
const passwordValidator = composeValidators(
  required('Enter a password'),
  minLength(PASSWORD_MINLENGTH, `Use at least ${PASSWORD_MINLENGTH} characters`),
)
const confirmPasswordValidator = composeValidators(
  required('Confirm your password'),
  matchesOther('password', 'Enter a matching password'),
)

@form({
  username: usernameValidator,
  token: tokenValidator,
  password: passwordValidator,
  confirmPassword: confirmPasswordValidator,
})
class ResetPasswordForm extends React.Component {
  render() {
    const { onSubmit, bindInput } = this.props
    const textInputProps = {
      autoCapitalize: 'off',
      autoCorrect: 'off',
      spellCheck: false,
      tabIndex: 1,
    }
    return (
      <form noValidate={true} onSubmit={onSubmit}>
        <SubmitOnEnter />
        <FieldRow>
          <AuthTextField
            {...bindInput('username')}
            inputProps={textInputProps}
            label='Username'
            floatingLabel={true}
          />
        </FieldRow>
        <FieldRow>
          <AuthTextField
            {...bindInput('token')}
            inputProps={textInputProps}
            label='Password reset code'
            floatingLabel={true}
          />
        </FieldRow>
        <FieldRow>
          <AuthPasswordTextField
            {...bindInput('password')}
            inputProps={textInputProps}
            label='New password'
            floatingLabel={true}
          />
        </FieldRow>
        <FieldRow>
          <AuthPasswordTextField
            {...bindInput('confirmPassword')}
            inputProps={textInputProps}
            label='Confirm new password'
            floatingLabel={true}
          />
        </FieldRow>
        <FieldRow>
          <RaisedButton label='Set new password' onClick={onSubmit} tabIndex={1} />
        </FieldRow>
      </form>
    )
  }
}

const RESET_PASSWORD_SUCCESS = 'Your password has been reset.'
const doPasswordReset = values => resetPassword(values.username, values.token, values.password)
export const ResetPassword = () => {
  const model = queryString.parse(location.search)
  return (
    <ForgotFormHolder
      form={ResetPasswordForm}
      model={model}
      title={'Reset password'}
      doSubmit={doPasswordReset}
      successMessage={RESET_PASSWORD_SUCCESS}
    />
  )
}
