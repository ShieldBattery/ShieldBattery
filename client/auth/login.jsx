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
  FieldRow,
  ForgotActionButton,
  LoadingArea,
  RowEdge,
  Spacer,
} from './auth-content'
import { redirectIfLoggedIn } from './auth-utils'
import { UserErrorDisplay } from './user-error-display'

// TODO(2Pac): Use the `useTranslation` hook once this is moved over to a functional component. Note
// that I'm using the global version of the `t` function here. react-i18next also exposes a HOC that
// can be used with class components to make the `t` function reactive, but making that work with
// form validators here would be quite cumbersome, so this seemed easier until it gets replaced with
// hooks.
import i18n from '../i18n/i18next'
const t = i18n.t

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
const passwordValidator = composeValidators(
  required(t('auth.passwordValidator.required', 'Enter a password')),
  minLength(
    PASSWORD_MINLENGTH,
    t('auth.passwordValidator.minLength2', {
      defaultValue: `Enter at least {{minLength}} characters`,
      minLength: PASSWORD_MINLENGTH,
    }),
  ),
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
            label={t('common.literals.username', 'Username')}
            floatingLabel={true}
            inputProps={{
              tabIndex: 1,
              autoCapitalize: 'off',
              autoCorrect: 'off',
              spellCheck: false,
            }}
          />
          <RowEdge>
            <ForgotActionButton
              label={t('auth.login.forgotUsername', 'Forgot username?')}
              onClick={onForgotUsernameClick}
            />
          </RowEdge>
        </FieldRow>

        <FieldRow>
          <RowEdge />
          <AuthPasswordTextField
            {...bindInput('password')}
            label={t('common.literals.password', 'Password')}
            floatingLabel={true}
            inputProps={{
              tabIndex: 1,
              autoCapitalize: 'off',
              autoCorrect: 'off',
              spellCheck: false,
            }}
          />
          <RowEdge>
            <ForgotActionButton
              label={t('auth.login.forgotPassword', 'Forgot password?')}
              onClick={onForgotPasswordClick}
            />
          </RowEdge>
        </FieldRow>

        <FieldRow>
          <RowEdge />
          <AuthCheckBox
            {...bindCheckable('remember')}
            label={t('account.login.rememberMe', 'Remember me')}
            inputProps={{ tabIndex: 1 }}
          />
          <Spacer />
          <RaisedButton
            label={t('common.literals.login', 'Log in')}
            onClick={onSubmit}
            tabIndex={1}
            testName='submit-button'
          />
          <RowEdge />
        </FieldRow>
      </form>
    )
  }
}

@connect(state => ({ auth: state.auth }))
export default class Login extends React.Component {
  state = {
    isLoading: false,
    lastError: undefined,
  }
  _form = null
  _setForm = elem => {
    this._form = elem
  }
  _abortController = undefined

  componentDidMount() {
    redirectIfLoggedIn(this.props)
  }

  componentDidUpdate() {
    redirectIfLoggedIn(this.props)
  }

  render() {
    const {
      auth: { authChangeInProgress },
    } = this.props
    const { isLoading, lastError } = this.state

    let loadingContents
    if (authChangeInProgress || isLoading) {
      loadingContents = (
        <LoadingArea>
          <LoadingIndicator />
        </LoadingArea>
      )
    }

    return (
      <AuthContent>
        <AuthContentContainer isLoading={isLoading || authChangeInProgress}>
          <AuthTitle>{t('auth.login.title', 'Log in')}</AuthTitle>
          <AuthBody>{lastError ? <UserErrorDisplay error={lastError} /> : null}</AuthBody>
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
            label={t('auth.login.signUp', 'Sign up for an account')}
            onClick={this.onCreateAccountClick}
            tabIndex={1}
          />
          <BottomActionButton
            label={t('auth.login.whatIsShieldBattery', 'What is ShieldBattery?')}
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
    this._abortController?.abort()

    const abortController = (this._abortController = new AbortController())
    this.setState({
      isLoading: true,
      lastError: undefined,
    })
    this.props.dispatch(
      logIn(
        {
          username: values.username,
          password: values.password,
          remember: values.remember,
        },
        {
          onSuccess: () => {},
          onError: err => {
            this.setState({
              isLoading: false,
              lastError: err,
            })
          },
          signal: abortController.signal,
        },
      ),
    )
  }
}
