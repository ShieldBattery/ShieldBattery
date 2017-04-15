import React from 'react'
import { connect } from 'react-redux'
import { routerActions } from 'react-router-redux'
import { redirectIfLoggedIn } from './auth-utils'
import FlatButton from '../material/flat-button.jsx'
import LoadingIndicator from '../progress/dots.jsx'
import RaisedButton from '../material/raised-button.jsx'
import { logIn } from './auther'
import form from '../forms/form.jsx'
import SubmitOnEnter from '../forms/submit-on-enter.jsx'
import TextField from '../material/text-field.jsx'
import CheckBox from '../material/check-box.jsx'
import {
  composeValidators,
  minLength,
  maxLength,
  regex,
  required,
} from '../forms/validators'
import styles from './login.css'
import {
  USERNAME_MINLENGTH,
  USERNAME_MAXLENGTH,
  USERNAME_PATTERN,
  PASSWORD_MINLENGTH,
} from '../../app/common/constants'

const usernameValidator = composeValidators(
    required('Enter a username'),
    minLength(USERNAME_MINLENGTH,
        `Enter at least ${USERNAME_MINLENGTH} characters`),
    maxLength(USERNAME_MAXLENGTH,
        `Enter at most ${USERNAME_MAXLENGTH} characters`),
    regex(USERNAME_PATTERN,
        'Username contains invalid characters'))
const passwordValidator = composeValidators(
    required('Enter a password'),
    minLength(PASSWORD_MINLENGTH,
        `Enter at least ${PASSWORD_MINLENGTH} characters`))

@form({
  username: usernameValidator,
  password: passwordValidator,
})
class LoginForm extends React.Component {
  render() {
    const {
      onSubmit,
      bindInput,
      bindCheckable,
      onForgotUsernameClick,
      onForgotPasswordClick,
    } = this.props
    return (<form noValidate={true} onSubmit={onSubmit}>
      <SubmitOnEnter/>
      <div className={styles.fieldRow}>
        <div className={styles.rowEdge}/>
        <TextField {...bindInput('username')} className={styles.textField}
            label='Username' floatingLabel={true}
            inputProps={{
              tabIndex: 1,
              autoCapitalize: 'off',
              autoCorrect: 'off',
              spellCheck: false,
            }}/>
        <div className={styles.rowEdge}>
          <FlatButton labelClassName={styles.forgotActionLabel}
              label='Forgot username?' onClick={onForgotUsernameClick}/>
        </div>
      </div>

      <div className={styles.fieldRow}>
        <div className={styles.rowEdge}/>
        <TextField {...bindInput('password')} className={styles.textField}
            label='Password' floatingLabel={true} type='password'
            inputProps={{
              tabIndex: 1,
              autoCapitalize: 'off',
              autoCorrect: 'off',
              spellCheck: false,
            }}/>
        <div className={styles.rowEdge}>
          <FlatButton labelClassName={styles.forgotActionLabel}
              label='Forgot password?' onClick={onForgotPasswordClick}/>
        </div>
      </div>

      <div className={styles.fieldRow}>
        <div className={styles.rowEdge}/>
        <CheckBox {...bindCheckable('remember')} className={styles.checkBox} label='Remember me'
            inputProps={{ tabIndex: 1 }} />
        <div className={styles.spacer}/>
        <RaisedButton label='Log in' onClick={onSubmit} tabIndex={1}/>
        <div className={styles.rowEdge}/>
      </div>
    </form>)
  }
}

@connect(state => ({ auth: state.auth }))
export default class Login extends React.Component {
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
    const { auth: { authChangeInProgress, lastFailure } } = this.props
    let loadingContents
    if (authChangeInProgress) {
      loadingContents = <div className={styles.loadingArea}><LoadingIndicator /></div>
    }
    let errContents
    const reqId = this.state.reqId
    if (reqId && lastFailure && lastFailure.reqId === reqId) {
      errContents = <div className={styles.errors}>Error: {lastFailure.err}</div>
    }

    return (<div className={styles.content}>
      <div className={authChangeInProgress ? styles.formLoading : styles.form}>
        <h3 className={styles.title}>Log in</h3>
          { errContents }
          <LoginForm ref={this._setForm} model={{}} onSubmit={this.onSubmit}
              onForgotUsernameClick={this.onForgotUsernameClick}
              onForgotPasswordClick={this.onForgotPasswordClick}/>
      </div>
      { loadingContents }
      <div className={styles.bottomAction}>
          <FlatButton labelClassName={styles.bottomActionButtonLabel}
              label='Sign up for an account' onClick={this.onCreateAccountClick} tabIndex={1}/>
          <FlatButton labelClassName={styles.bottomActionButtonLabel}
              label='View beta info' onClick={this.onSignUpClick} tabIndex={1}/>
      </div>
    </div>)
  }

  onSignUpClick = () => {
    this.props.dispatch(routerActions.push({ pathname: '/splash' }))
  }

  onCreateAccountClick = () => {
    const query = {
      ...this.props.location.query,
      username: this._form.getModel().username,
    }
    this.props.dispatch(routerActions.push({ pathname: '/signup', query }))
  }

  onForgotUsernameClick = () => {
    this.props.dispatch(routerActions.push({ pathname: '/forgot-user' }))
  }

  onForgotPasswordClick = () => {
    this.props.dispatch(routerActions.push({ pathname: '/forgot-password' }))
  }

  onSubmit = () => {
    const values = this._form.getModel()
    const { id, action } = logIn(values.username, values.password, values.remember)
    this.setState({
      reqId: id
    })
    this.props.dispatch(action)
  }
}
