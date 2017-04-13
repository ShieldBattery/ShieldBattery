import React, { PropTypes } from 'react'
import { connect } from 'react-redux'
import { routerActions } from 'react-router-redux'
import FlatButton from '../material/flat-button.jsx'
import LoadingIndicator from '../progress/dots.jsx'
import RaisedButton from '../material/raised-button.jsx'
import { retrieveUsername, startPasswordReset, resetPassword } from './auther'
import form from '../forms/form.jsx'
import SubmitOnEnter from '../forms/submit-on-enter.jsx'
import TextField from '../material/text-field.jsx'
import {
  composeValidators,
  minLength,
  maxLength,
  matchesOther,
  regex,
  required,
} from '../forms/validators'
import {
  EMAIL_MINLENGTH,
  EMAIL_MAXLENGTH,
  EMAIL_PATTERN,
  PASSWORD_MINLENGTH,
  USERNAME_MINLENGTH,
  USERNAME_MAXLENGTH,
  USERNAME_PATTERN,
} from '../../app/common/constants'

import styles from './forgot.css'

const emailValidator = composeValidators(
    required('Enter an email address'),
    minLength(EMAIL_MINLENGTH, `Use at least ${EMAIL_MINLENGTH} characters`),
    maxLength(EMAIL_MAXLENGTH, `Use at most ${EMAIL_MAXLENGTH} characters`),
    regex(EMAIL_PATTERN, 'Enter a valid email address'))
const usernameValidator = composeValidators(
    required('Enter a username'),
    minLength(USERNAME_MINLENGTH,
        `Enter at least ${USERNAME_MINLENGTH} characters`),
    maxLength(USERNAME_MAXLENGTH,
        `Enter at most ${USERNAME_MAXLENGTH} characters`),
    regex(USERNAME_PATTERN,
        'Username contains invalid characters'))

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
  _setForm = elem => { this._form = elem }

  componentWillUpdate(nextProps, nextState) {
    if (this.props.auth.authChangeInProgress && !nextProps.auth.authChangeInProgress) {
      if (this.state.reqId && !nextProps.auth.lastFailure) {
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
      loadingContents = <div className={styles.loadingArea}><LoadingIndicator /></div>
    }
    let errContents
    const reqId = this.state.reqId
    if (reqId && lastFailure && lastFailure.reqId === reqId) {
      errContents = <div className={styles.errors}>Error: {lastFailure.err}</div>
    }
    const successContents = this.state.success && successMessage ?
      <p className={styles.success}>{successMessage}</p> :
      null

    return (<div className={styles.content}>
      <div className={authChangeInProgress ? styles.formLoading : styles.form}>
        <h3 className={styles.title}>{title}</h3>
        <div className={styles.formContents}>
          { errContents }
          { successContents }
          { loadingContents }
          <FormComponent ref={this._setForm} model={model || {}} onSubmit={this.onSubmit}/>
        </div>
      </div>
      <div className={styles.bottomAction}>
          <FlatButton labelClassName={styles.bottomActionButtonLabel}
              label='Back to login' onClick={this.onBackClick} tabIndex={1}/>
      </div>
    </div>)
  }

  onBackClick = () => {
    this.props.dispatch(routerActions.push({ pathname: '/login' }))
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
    const {
      onSubmit,
      bindInput,
    } = this.props
    return (<form noValidate={true} onSubmit={onSubmit}>
      <SubmitOnEnter/>
      <p>Please enter the email address you signed up with.</p>
      <div className={styles.fieldRow}>
        <TextField {...bindInput('email')} className={styles.textField}
            label='Email address' floatingLabel={true}
            inputProps={{
              tabIndex: 1,
              autoCapitalize: 'off',
              autoCorrect: 'off',
              spellCheck: false,
            }}/>
      </div>
      <div className={styles.fieldRow}>
        <RaisedButton label='Recover username' onClick={onSubmit} tabIndex={1}/>
      </div>
    </form>)
  }
}

const FORGOT_USER_SUCCESS = 'If there are any users registered to that email address, you should ' +
    'receive an email in the next few minutes with the relevant usernames.'
const doForgotUserSubmit = values => retrieveUsername(values.email)
export const ForgotUser = () => (<ForgotFormHolder form={ForgotUserForm}
    title={'Recover your username'} doSubmit={doForgotUserSubmit}
    successMessage={FORGOT_USER_SUCCESS}/>)

@form({
  email: emailValidator,
  username: usernameValidator,
})
class ForgotPasswordForm extends React.Component {
  render() {
    const {
      onSubmit,
      bindInput,
    } = this.props
    return (<form noValidate={true} onSubmit={onSubmit}>
      <SubmitOnEnter/>
      <div className={styles.fieldRow}>
        <TextField {...bindInput('email')} className={styles.textField}
            label='Email address' floatingLabel={true}
            inputProps={{
              tabIndex: 1,
              autoCapitalize: 'off',
              autoCorrect: 'off',
              spellCheck: false,
            }}/>
      </div>
      <div className={styles.fieldRow}>
        <TextField {...bindInput('username')} className={styles.textField}
            label='Username' floatingLabel={true}
            inputProps={{
              tabIndex: 1,
              autoCapitalize: 'off',
              autoCorrect: 'off',
              spellCheck: false,
            }}/>
      </div>
      <div className={styles.fieldRow}>
        <RaisedButton label='Send reset email' onClick={onSubmit} tabIndex={1}/>
      </div>
    </form>)
  }
}

const FORGOT_PASSWORD_SUCCESS = 'If that email address and username match a registered account, ' +
    'you should receive an email in the next few minutes with instructions on how to reset ' +
    'your password.'
const doPasswordResetStart = values => startPasswordReset(values.username, values.email)
export const ForgotPassword = () => (<ForgotFormHolder form={ForgotPasswordForm}
    title={'Reset password'} doSubmit={doPasswordResetStart}
    successMessage={FORGOT_PASSWORD_SUCCESS}/>)


const tokenValidator = required('Enter your password reset code')
const passwordValidator = composeValidators(
    required('Enter a password'),
    minLength(PASSWORD_MINLENGTH, `Use at least ${PASSWORD_MINLENGTH} characters`))
const confirmPasswordValidator = composeValidators(
    required('Confirm your password'),
    matchesOther('password', 'Enter a matching password'))

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
    return (<form noValidate={true} onSubmit={onSubmit}>
      <SubmitOnEnter/>
      <div className={styles.fieldRow}>
        <TextField {...bindInput('username')} inputProps={textInputProps}
            label='Username' floatingLabel={true}/>
      </div>
      <div className={styles.fieldRow}>
        <TextField {...bindInput('token')} inputProps={textInputProps}
            label='Password reset code' floatingLabel={true}/>
      </div>
      <div className={styles.fieldRow}>
        <TextField {...bindInput('password')} inputProps={textInputProps}
            label='New password' floatingLabel={true} type='password'/>
      </div>
      <div className={styles.fieldRow}>
        <TextField {...bindInput('confirmPassword')} inputProps={textInputProps}
            label='Confirm new password' floatingLabel={true} type='password'/>
      </div>
      <div className={styles.fieldRow}>
        <RaisedButton label='Set new password' onClick={onSubmit} tabIndex={1}/>
      </div>
    </form>)
  }
}

const RESET_PASSWORD_SUCCESS = 'Your password has been reset.'
const doPasswordReset = values => resetPassword(values.username, values.token, values.password)
export const ResetPassword = ({ location }) => {
  const model = {
    username: location.query.username,
    token: location.query.token,
  }
  return (<ForgotFormHolder form={ResetPasswordForm}
      model={model}
      title={'Reset password'}
      doSubmit={doPasswordReset}
      successMessage={RESET_PASSWORD_SUCCESS}/>)
}
