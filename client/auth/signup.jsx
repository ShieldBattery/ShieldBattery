import React from 'react'
import { connect } from 'react-redux'
import { routerActions } from 'react-router-redux'
import { redirectIfLoggedIn } from './auth-utils'
import Card from '../material/card.jsx'
import FlatButton from '../material/flat-button.jsx'
import LoadingIndicator from '../progress/dots.jsx'
import RaisedButton from '../material/raised-button.jsx'
import form from '../forms/form.jsx'
import TextField from '../material/text-field.jsx'
import {
  composeValidators,
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
} from '../../shared/constants'
import auther from './auther'
import styles from './login.css'

const usernameValidator = composeValidators(
    required('Enter a username'),
    minLength(USERNAME_MINLENGTH, `Use at least ${USERNAME_MINLENGTH} characters`),
    maxLength(USERNAME_MAXLENGTH, `Use at most ${USERNAME_MAXLENGTH} characters`),
    regex(USERNAME_PATTERN, 'Username contains invalid characters'))
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
    const { auth, location } = this.props
    if (auth.authChangeInProgress) {
      return <Card><LoadingIndicator /></Card>
    }

    let errContents
    const failure = auth.lastFailure
    const reqId = this.state.reqId
    if (reqId && failure && failure.reqId === reqId) {
      errContents = <div className={styles.errors}>Error: {failure.err}</div>
    }

    const model = {
      username: location.query.username,
      email: location.query.email,
      token: location.query.token,
    }

    return (<div className={styles.content}>
      <Card zDepth={1}>
        <h3>Create account</h3>
        { errContents }
        <SignupForm ref={this._setForm} model={model} onSubmit={this.onSubmit}/>
        <RaisedButton label='Create account' onClick={this.onSignUpClick} tabIndex={1}/>
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
    const { id, action } =
        auther.signUp(values.username, values.email, values.password, values.token)
    this.setState({
      reqId: id
    })
    this.props.dispatch(action)
  };
}
