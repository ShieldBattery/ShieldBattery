import queryString from 'query-string'
import React, { useEffect, useRef, useState } from 'react'
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
import { Trans, useTranslation } from 'react-i18next'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { usePrevious, useStableCallback } from '../state-hooks'

const emailValidator = composeValidators(
  required(t => t('auth.emailValidator.required', 'Enter an email address')),
  minLength(EMAIL_MINLENGTH),
  maxLength(EMAIL_MAXLENGTH),
  regex(EMAIL_PATTERN, t => t('auth.emailValidator.pattern', 'Enter a valid email address')),
)
const usernameValidator = composeValidators(
  required(t => t('auth.usernameValidator.required', 'Enter a username')),
  minLength(USERNAME_MINLENGTH),
  maxLength(USERNAME_MAXLENGTH),
  regex(USERNAME_PATTERN, t =>
    t('auth.usernameValidator.pattern', 'Username contains invalid characters'),
  ),
)

function ForgotFormHolder(props) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const auth = useAppSelector(state => state.auth)

  const [reqId, setReqId] = useState()
  const [success, setSuccess] = useState(false)
  const formRef = useRef(null)

  const authChangeInProgress = auth.authChangeInProgress
  const prevAuthChangeInProgress = usePrevious(authChangeInProgress)
  const lastFailure = auth.lastFailure

  useEffect(() => {
    if (prevAuthChangeInProgress && !authChangeInProgress) {
      if (reqId && !lastFailure) {
        formRef.current.reset()
        setSuccess(true)
      }
    }
  }, [authChangeInProgress, lastFailure, prevAuthChangeInProgress, reqId])

  const onBackClick = useStableCallback(() => {
    push({ pathname: '/login' })
  })

  const onSubmit = useStableCallback(() => {
    const values = formRef.current.getModel()
    const { id, action } = props.doSubmit(values)
    setReqId(id)
    setSuccess(false)
    dispatch(action)
  })

  const { form: FormComponent, model, title, successMessage } = props
  let loadingContents
  if (authChangeInProgress) {
    loadingContents = (
      <LoadingArea>
        <LoadingIndicator />
      </LoadingArea>
    )
  }
  let errContents
  if (reqId && lastFailure && lastFailure.reqId === reqId) {
    errContents = (
      <ErrorsContainer>
        <Trans t={t} i18nKey='auth.forgot.generalError'>
          Error: {{ error: lastFailure.err }}
        </Trans>
      </ErrorsContainer>
    )
  }
  const successContents =
    success && successMessage ? <SuccessContainer>{successMessage}</SuccessContainer> : null

  return (
    <AuthContent>
      <AuthContentContainer isLoading={authChangeInProgress}>
        <AuthTitle as='h3'>{title}</AuthTitle>
        <AuthBody>
          {errContents}
          {successContents}
          <FormComponent ref={formRef} model={model || {}} onSubmit={onSubmit} t={t} />
        </AuthBody>
      </AuthContentContainer>
      {loadingContents}
      <AuthBottomAction>
        <BottomActionButton
          label={t('auth.forgot.backToLogin', 'Back to login')}
          onClick={onBackClick}
          tabIndex={1}
        />
      </AuthBottomAction>
    </AuthContent>
  )
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
          {this.props.t(
            'auth.forgot.user.enterEmail',
            'Please enter the email address you signed up with.',
          )}
        </p>
        <FieldRow>
          <AuthTextField
            {...bindInput('email')}
            label={this.props.t('auth.forgot.user.emailAddress', 'Email address')}
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
            label={this.props.t('auth.forgot.user.recoverUsername', 'Recover username')}
            onClick={onSubmit}
            tabIndex={1}
          />
        </FieldRow>
      </form>
    )
  }
}

const doForgotUserSubmit = values => recoverUsername(values.email)
export function ForgotUser() {
  const { t } = useTranslation()

  return (
    <ForgotFormHolder
      form={ForgotUserForm}
      title={t('auth.forgot.user.title', 'Recover your username')}
      doSubmit={doForgotUserSubmit}
      successMessage={t(
        'auth.forgot.user.successMessage',
        'If there are any users registered to that email address, you should ' +
          'receive an email in the next few minutes with the relevant usernames.',
      )}
    />
  )
}

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
            label={this.props.t('auth.forgot.password.emailAddress', 'Email address')}
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
            label={this.props.t('auth.forgot.password.username', 'Username')}
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
            label={this.props.t('auth.forgot.password.sendResetEmail', 'Send reset email')}
            onClick={onSubmit}
            tabIndex={1}
          />
        </FieldRow>
      </form>
    )
  }
}

const doPasswordResetStart = values => startPasswordReset(values.username, values.email)
export function ForgotPassword() {
  const { t } = useTranslation()

  return (
    <ForgotFormHolder
      form={ForgotPasswordForm}
      title={t('auth.forgot.password.title', 'Reset password')}
      doSubmit={doPasswordResetStart}
      successMessage={t(
        'auth.forgot.password.successMessage',
        'If that email address and username match a registered account, ' +
          'you should receive an email in the next few minutes with instructions on how to reset ' +
          'your password.',
      )}
    />
  )
}

const tokenValidator = required(t =>
  t('auth.passwordValidator.resetCode', 'Enter your password reset code'),
)
const passwordValidator = composeValidators(
  required(t => t('auth.passwordValidator.required', 'Enter a password')),
  minLength(PASSWORD_MINLENGTH),
)
const confirmPasswordValidator = composeValidators(
  required(t => t('auth.passwordValidator.confirm', 'Confirm your password')),
  matchesOther('password', t => t('auth.passwordValidator.matching', 'Enter a matching password')),
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
            label={this.props.t('auth.forgot.reset.username', 'Username')}
            floatingLabel={true}
          />
        </FieldRow>
        <FieldRow>
          <AuthTextField
            {...bindInput('token')}
            inputProps={textInputProps}
            label={this.props.t('auth.forgot.reset.passwordCode', 'Password reset code')}
            floatingLabel={true}
          />
        </FieldRow>
        <FieldRow>
          <AuthPasswordTextField
            {...bindInput('password')}
            inputProps={textInputProps}
            label={this.props.t('auth.forgot.reset.newPassword', 'New password')}
            floatingLabel={true}
          />
        </FieldRow>
        <FieldRow>
          <AuthPasswordTextField
            {...bindInput('confirmPassword')}
            inputProps={textInputProps}
            label={this.props.t('auth.forgot.reset.confirmPassword', 'Confirm new password')}
            floatingLabel={true}
          />
        </FieldRow>
        <FieldRow>
          <RaisedButton
            label={this.props.t('auth.forgot.reset.setNewPassword', 'Set new password')}
            onClick={onSubmit}
            tabIndex={1}
          />
        </FieldRow>
      </form>
    )
  }
}

const doPasswordReset = values => resetPassword(values.username, values.token, values.password)
export function ResetPassword() {
  const { t } = useTranslation()
  const model = queryString.parse(location.search)
  return (
    <ForgotFormHolder
      form={ResetPasswordForm}
      model={model}
      title={t('auth.forgot.reset.title', 'Reset password')}
      doSubmit={doPasswordReset}
      successMessage={t('auth.forgot.reset.successMessage', 'Your password has been reset.')}
    />
  )
}
