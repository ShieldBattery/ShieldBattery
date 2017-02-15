import React from 'react'
import { connect } from 'react-redux'
import { routerActions } from 'react-router-redux'
import fetch from '../network/fetch'
import { redirectIfLoggedIn } from './auth-utils'
import Card from '../material/card.jsx'
import FlatButton from '../material/flat-button.jsx'
import LoadingIndicator from '../progress/dots.jsx'
import RaisedButton from '../material/raised-button.jsx'
import form from '../forms/form.jsx'
import SubmitOnEnter from '../forms/submit-on-enter.jsx'
import TextField from '../material/text-field.jsx'
import {
  composeValidators,
  debounce,
  minLength,
  maxLength,
  regex,
  required,
  matchesOther,
} from '../forms/validators'
import {
  USERNAME_MINLENGTH,
  USERNAME_MAXLENGTH,
  USERNAME_PATTERN,
  EMAIL_MINLENGTH,
  EMAIL_MAXLENGTH,
  EMAIL_PATTERN,
  PASSWORD_MINLENGTH,
} from '../../app/common/constants'
import { signUp } from './auther'
import styles from './login.css'

async function usernameAvailable(val) {
  try {
    const result = await fetch(`/api/1/usernameAvailability/${encodeURIComponent(val)}`)
    if (result.available) {
      return null
    }
  } catch (ignored) {
    // TODO(tec27): handle non-404 errors differently
  }

  return 'Username is already taken'
}

const usernameValidator = composeValidators(
    required('Enter a username'),
    minLength(USERNAME_MINLENGTH, `Use at least ${USERNAME_MINLENGTH} characters`),
    maxLength(USERNAME_MAXLENGTH, `Use at most ${USERNAME_MAXLENGTH} characters`),
    regex(USERNAME_PATTERN, 'Username contains invalid characters'),
    debounce(usernameAvailable, 250))
const emailValidator = composeValidators(
    required('Enter an email address'),
    minLength(EMAIL_MINLENGTH, `Use at least ${EMAIL_MINLENGTH} characters`),
    maxLength(EMAIL_MAXLENGTH, `Use at most ${EMAIL_MAXLENGTH} characters`),
    regex(EMAIL_PATTERN, 'Enter a valid email address'))
const passwordValidator = composeValidators(
    required('Enter a password'),
    minLength(PASSWORD_MINLENGTH, `Use at least ${PASSWORD_MINLENGTH} characters`))
const confirmPasswordValidator = composeValidators(
    required('Confirm your password'),
    matchesOther('password', 'Enter a matching password'))
const tokenValidator = required('Enter your invite code')

@form({
  username: usernameValidator,
  email: emailValidator,
  password: passwordValidator,
  confirmPassword: confirmPasswordValidator,
  token: tokenValidator,
})
class SignupForm extends React.Component {
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
      <TextField {...bindInput('username')} inputProps={textInputProps}
          label='Username' floatingLabel={true}/>
      <TextField {...bindInput('email')} inputProps={textInputProps}
          label='Email address' floatingLabel={true}/>
      <TextField {...bindInput('password')} inputProps={textInputProps}
          label='Password' floatingLabel={true} type='password'/>
      <TextField {...bindInput('confirmPassword')} inputProps={textInputProps}
          label='Confirm password' floatingLabel={true} type='password'/>
      <TextField {...bindInput('token')} inputProps={textInputProps}
          label='Invite code' floatingLabel={true}/>
    </form>)
  }
}

@connect(state => ({ auth: state.auth }))
export default class Signup extends React.Component {
  state = {
    reqId: null,
  };
  _form = null;
  _setForm = elem => { this._form = elem };

  componentDidMount() {
    redirectIfLoggedIn(this.props)
  }

  componentWillReceiveProps(nextProps) {
    redirectIfLoggedIn(nextProps)
  }

  render() {
    const { auth: { authChangeInProgress, lastFailure }, location } = this.props
    let loadingContents
    if (authChangeInProgress) {
      loadingContents = <div className={styles.loadingArea}><LoadingIndicator /></div>
    }

    let errContents
    const reqId = this.state.reqId
    if (reqId && lastFailure && lastFailure.reqId === reqId) {
      errContents = <div className={styles.errors}>Error: {lastFailure.err}</div>
    }

    const model = {
      username: location.query.username,
      email: location.query.email,
      token: location.query.token,
    }

    return (<div className={styles.content}>
      <Card className={styles.card}>
        <div className={authChangeInProgress ? styles.formLoading : styles.form}>
          <h3 className={styles.cardTitle}>Create account</h3>
          { errContents }
          <SignupForm ref={this._setForm} model={model} onSubmit={this.onSubmit}/>
          <RaisedButton label='Create account' onClick={this.onSignUpClick} tabIndex={1}/>
        </div>
        { loadingContents }
      </Card>
      <div className={styles.bottomAction}>
        <p>Already have an account?</p>
        <FlatButton label='Log in' onClick={this.onLogInClick} tabIndex={1} />
      </div>
    </div>)
  }

  onSignUpClick = () => {
    this._form.submit()
  };

  onLogInClick = () => {
    const query = {
      ...this.props.location.query,
    }
    this.props.dispatch(routerActions.push({ pathname: '/login', query }))
  };

  onSubmit = () => {
    const values = this._form.getModel()
    const { id, action } = signUp(values.username, values.email, values.password, values.token)
    this.setState({
      reqId: id
    })
    this.props.dispatch(action)
  };
}
