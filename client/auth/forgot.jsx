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
import { RaisedButton } from '../material/button'
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

// TODO(2Pac): Use the `useTranslation` hook once this is moved over to a functional component. Note
// that I'm using the global version of the `t` function here. react-i18next also exposes a HOC that
// can be used with class components to make the `t` function reactive, but making that work with
// form validators here would be quite cumbersome, so this seemed easier until it gets replaced with
// hooks.
import { Trans } from 'react-i18next'
import { t } from '../i18n/i18next'

const emailValidator = composeValidators(
  required(t('auth.emailValidator.required', 'Enter an email address')),
  minLength(
    EMAIL_MINLENGTH,
    t('auth.emailValidator.minLength', {
      defaultValue: `Use at least {{minLength}} characters`,
      minLength: EMAIL_MINLENGTH,
    }),
  ),
  maxLength(
    EMAIL_MAXLENGTH,
    t('auth.emailValidator.maxLength', {
      defaultValue: `Use at most {{maxLength}} characters`,
      maxLength: EMAIL_MAXLENGTH,
    }),
  ),
  regex(EMAIL_PATTERN, t('auth.emailValidator.pattern', 'Enter a valid email address')),
)
const usernameValidator = composeValidators(
  required(t('auth.usernameValidator.required', 'Enter a username')),
  minLength(
    USERNAME_MINLENGTH,
    t('auth.usernameValidator.minLength', {
      defaultValue: `Enter at least {{minLength}} characters`,
      minLength: USERNAME_MINLENGTH,
    }),
  ),
  maxLength(
    USERNAME_MAXLENGTH,
    t('auth.usernameValidator.maxLength', {
      defaultValue: `Enter at most {{maxLength}} characters`,
      maxLength: USERNAME_MAXLENGTH,
    }),
  ),
  regex(
    USERNAME_PATTERN,
    t('auth.usernameValidator.pattern', 'Username contains invalid characters'),
  ),
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
      errContents = (
        <ErrorsContainer>
          <Trans t={t} i18nKey='auth.forgot.generalError'>
            Error: {lastFailure.err}
          </Trans>
        </ErrorsContainer>
      )
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
          <BottomActionButton
            label={t('auth.forgot.backToLogin', 'Back to login.')}
            onClick={this.onBackClick}
            tabIndex={1}
          />
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
        <p>
          <Trans t={t} i18nKey='auth.forgot.user.enterEmail'>
            Please enter the email address you signed up with.
          </Trans>
        </p>
        <FieldRow>
          <AuthTextField
            {...bindInput('email')}
            label={t('common.literals.emailAddress', 'Email address')}
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
          <RaisedButton
            label={t('auth.forgot.user.recoverUsername', 'Recover username')}
            onClick={onSubmit}
            tabIndex={1}
          />
        </FieldRow>
      </form>
    )
  }
}

const FORGOT_USER_SUCCESS = t(
  'auth.forgot.user.successMessage',
  'If there are any users registered to that email address, you should ' +
    'receive an email in the next few minutes with the relevant usernames.',
)
const doForgotUserSubmit = values => recoverUsername(values.email)
export const ForgotUser = () => (
  <ForgotFormHolder
    form={ForgotUserForm}
    title={t('auth.forgot.user.title', 'Recover your username')}
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
            label={t('common.literals.emailAddress', 'Email address')}
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
            label={t('common.literals.username', 'Username')}
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
          <RaisedButton
            label={t('auth.forgot.password.sendResetEmail', 'Send reset email')}
            onClick={onSubmit}
            tabIndex={1}
          />
        </FieldRow>
      </form>
    )
  }
}

const FORGOT_PASSWORD_SUCCESS = t(
  'auth.forgot.password.successMessage',
  'If that email address and username match a registered account, ' +
    'you should receive an email in the next few minutes with instructions on how to reset ' +
    'your password.',
)
const doPasswordResetStart = values => startPasswordReset(values.username, values.email)
export const ForgotPassword = () => (
  <ForgotFormHolder
    form={ForgotPasswordForm}
    title={t('auth.forgot.password.title', 'Reset password')}
    doSubmit={doPasswordResetStart}
    successMessage={FORGOT_PASSWORD_SUCCESS}
  />
)

const tokenValidator = required(
  t('auth.passwordValidator.resetCode', 'Enter your password reset code'),
)
const passwordValidator = composeValidators(
  required(t('auth.passwordValidator.required', 'Enter a password')),
  minLength(
    PASSWORD_MINLENGTH,
    t('auth.passwordValidator.minLength', {
      defaultValue: `Use at least {{minLength}} characters`,
      minLength: PASSWORD_MINLENGTH,
    }),
  ),
)
const confirmPasswordValidator = composeValidators(
  required(t('auth.passwordValidator.confirm', 'Confirm your password')),
  matchesOther('password', t('auth.passwordValidator.matching', 'Enter a matching password')),
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
            label={t('common.literals.username', 'Username')}
            floatingLabel={true}
          />
        </FieldRow>
        <FieldRow>
          <AuthTextField
            {...bindInput('token')}
            inputProps={textInputProps}
            label={t('auth.forgot.reset.passwordCode', 'Password reset code')}
            floatingLabel={true}
          />
        </FieldRow>
        <FieldRow>
          <AuthPasswordTextField
            {...bindInput('password')}
            inputProps={textInputProps}
            label={t('auth.forgot.reset.newPassword', 'New password')}
            floatingLabel={true}
          />
        </FieldRow>
        <FieldRow>
          <AuthPasswordTextField
            {...bindInput('confirmPassword')}
            inputProps={textInputProps}
            label={t('auth.forgot.reset.confirmPassword', 'Confirm new password')}
            floatingLabel={true}
          />
        </FieldRow>
        <FieldRow>
          <RaisedButton
            label={t('auth.forgot.reset.newPassword', 'Set new password')}
            onClick={onSubmit}
            tabIndex={1}
          />
        </FieldRow>
      </form>
    )
  }
}

const RESET_PASSWORD_SUCCESS = t(
  'auth.forgot.reset.successMessage',
  'Your password has been reset.',
)
const doPasswordReset = values => resetPassword(values.username, values.token, values.password)
export const ResetPassword = () => {
  const model = queryString.parse(location.search)
  return (
    <ForgotFormHolder
      form={ResetPasswordForm}
      model={model}
      title={t('auth.forgot.reset.title', 'Reset password')}
      doSubmit={doPasswordReset}
      successMessage={RESET_PASSWORD_SUCCESS}
    />
  )
}
