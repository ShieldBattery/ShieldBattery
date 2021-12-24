import queryString from 'query-string'
import React from 'react'
import { connect } from 'react-redux'
import {
  PASSWORD_MINLENGTH,
  USERNAME_MAXLENGTH,
  USERNAME_MINLENGTH,
  USERNAME_PATTERN,
} from '../../common/constants'
import form from '../forms/form'
import SubmitOnEnter from '../forms/submit-on-enter'
import { composeValidators, maxLength, minLength, regex, required } from '../forms/validators'
import { RaisedButton } from '../material/button'
import { push } from '../navigation/routing'
import LoadingIndicator from '../progress/dots'
import { logIn } from './action-creators'
import {
  AuthBody,
  AuthBottomAction,
  AuthCheckBox,
  AuthContent,
  AuthContentContainer,
  AuthPasswordTextField,
  AuthTextField,
  AuthTitle,
  BottomActionButton,
  ErrorsContainer,
  FieldRow,
  ForgotActionButton,
  LoadingArea,
  RowEdge,
  Spacer,
} from './auth-content'
import { redirectIfLoggedIn } from './auth-utils'

const usernameValidator = composeValidators(
  required('Enter a username'),
  minLength(USERNAME_MINLENGTH, `Enter at least ${USERNAME_MINLENGTH} characters`),
  maxLength(USERNAME_MAXLENGTH, `Enter at most ${USERNAME_MAXLENGTH} characters`),
  regex(USERNAME_PATTERN, 'Username contains invalid characters'),
)
const passwordValidator = composeValidators(
  required('Enter a password'),
  minLength(PASSWORD_MINLENGTH, `Enter at least ${PASSWORD_MINLENGTH} characters`),
)

@form({
  username: usernameValidator,
  password: passwordValidator,
})
class LoginForm extends React.Component {
  render() {
    const { onSubmit, bindInput, bindCheckable, onForgotUsernameClick, onForgotPasswordClick } =
      this.props
    return (
      <form noValidate={true} onSubmit={onSubmit}>
        <SubmitOnEnter />
        <FieldRow>
          <RowEdge />
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
          <RowEdge>
            <ForgotActionButton label='Forgot username?' onClick={onForgotUsernameClick} />
          </RowEdge>
        </FieldRow>

        <FieldRow>
          <RowEdge />
          <AuthPasswordTextField
            {...bindInput('password')}
            label='Password'
            floatingLabel={true}
            inputProps={{
              tabIndex: 1,
              autoCapitalize: 'off',
              autoCorrect: 'off',
              spellCheck: false,
            }}
          />
          <RowEdge>
            <ForgotActionButton label='Forgot password?' onClick={onForgotPasswordClick} />
          </RowEdge>
        </FieldRow>

        <FieldRow>
          <RowEdge />
          <AuthCheckBox
            {...bindCheckable('remember')}
            label='Remember me'
            inputProps={{ tabIndex: 1 }}
          />
          <Spacer />
          <RaisedButton label='Log in' onClick={onSubmit} tabIndex={1} />
          <RowEdge />
        </FieldRow>
      </form>
    )
  }
}

@connect(state => ({ auth: state.auth }))
export default class Login extends React.Component {
  state = {
    reqId: null,
  }
  _form = null
  _setForm = elem => {
    this._form = elem
  }

  componentDidMount() {
    redirectIfLoggedIn(this.props)
  }

  componentDidUpdate() {
    redirectIfLoggedIn(this.props)
  }

  render() {
    const {
      auth: { authChangeInProgress, lastFailure },
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

    return (
      <AuthContent>
        <AuthContentContainer isLoading={authChangeInProgress}>
          <AuthTitle>Log in</AuthTitle>
          <AuthBody>{errContents}</AuthBody>
          <LoginForm
            ref={this._setForm}
            model={{ username: queryString.parse(location.search).username ?? '' }}
            onSubmit={this.onSubmit}
            onForgotUsernameClick={this.onForgotUsernameClick}
            onForgotPasswordClick={this.onForgotPasswordClick}
          />
        </AuthContentContainer>
        {loadingContents}
        <AuthBottomAction>
          <BottomActionButton
            label='Sign up for an account'
            onClick={this.onCreateAccountClick}
            tabIndex={1}
          />
          <BottomActionButton
            label='What is ShieldBattery?'
            onClick={this.onSplashClick}
            tabIndex={1}
          />
        </AuthBottomAction>
      </AuthContent>
    )
  }

  onSplashClick = () => {
    push({ pathname: '/splash' })
  }

  onCreateAccountClick = () => {
    const search = queryString.stringify({
      ...queryString.parse(location.search),
      username: this._form.getModel().username,
    })
    push({ pathname: '/signup', search })
  }

  onForgotUsernameClick = () => {
    push({ pathname: '/forgot-user' })
  }

  onForgotPasswordClick = () => {
    push({ pathname: '/forgot-password' })
  }

  onSubmit = () => {
    const values = this._form.getModel()
    const { id, action } = logIn(values.username, values.password, values.remember)
    this.setState({
      reqId: id,
    })
    this.props.dispatch(action)
  }
}
