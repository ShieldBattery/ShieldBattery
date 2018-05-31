import React from 'react'
import { connect } from 'react-redux'
import { routerActions } from 'react-router-redux'
import queryString from 'query-string'
import fetch from '../network/fetch'
import { redirectIfLoggedIn } from './auth-utils'

import LoadingIndicator from '../progress/dots.jsx'
import RaisedButton from '../material/raised-button.jsx'
import form from '../forms/form.jsx'
import SubmitOnEnter from '../forms/submit-on-enter.jsx'
import {
  AuthContentContainer,
  AuthContent,
  AuthTitle,
  AuthBody,
  LoadingArea,
  ErrorsContainer,
  AuthBottomAction,
  BottomActionButton,
  FieldRow,
  AuthTextField,
} from './auth-content.jsx'

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

const SignupBottomAction = AuthBottomAction.extend`
  flex-direction: row;
  justify-content: center;

  & > p {
    margin-right: 8px;
  }
`

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
  debounce(usernameAvailable, 250),
)
const emailValidator = composeValidators(
  required('Enter an email address'),
  minLength(EMAIL_MINLENGTH, `Use at least ${EMAIL_MINLENGTH} characters`),
  maxLength(EMAIL_MAXLENGTH, `Use at most ${EMAIL_MAXLENGTH} characters`),
  regex(EMAIL_PATTERN, 'Enter a valid email address'),
)
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
  email: emailValidator,
  password: passwordValidator,
  confirmPassword: confirmPasswordValidator,
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

    return (
      <form noValidate={true} onSubmit={onSubmit}>
        <SubmitOnEnter />
        <FieldRow>
          <AuthTextField
            {...bindInput('username')}
            inputProps={textInputProps}
            label="Username"
            floatingLabel={true}
          />
        </FieldRow>

        <FieldRow>
          <AuthTextField
            {...bindInput('email')}
            inputProps={textInputProps}
            label="Email address"
            floatingLabel={true}
          />
        </FieldRow>

        <FieldRow>
          <AuthTextField
            {...bindInput('password')}
            inputProps={textInputProps}
            label="Password"
            floatingLabel={true}
            type="password"
          />
        </FieldRow>

        <FieldRow>
          <AuthTextField
            {...bindInput('confirmPassword')}
            inputProps={textInputProps}
            label="Confirm password"
            floatingLabel={true}
            type="password"
          />
        </FieldRow>

        <FieldRow>
          <RaisedButton label="Create account" onClick={onSubmit} tabIndex={1} />
        </FieldRow>
      </form>
    )
  }
}

@connect(state => ({ auth: state.auth }))
export default class Signup extends React.Component {
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

  componentWillReceiveProps(nextProps) {
    redirectIfLoggedIn(nextProps)
  }

  render() {
    const {
      auth: { authChangeInProgress, lastFailure },
      location,
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

    const model = queryString.parse(location.search)
    return (
      <AuthContent>
        <AuthContentContainer isLoading={authChangeInProgress}>
          <AuthTitle>Create account</AuthTitle>
          <AuthBody>
            {errContents}
            <SignupForm ref={this._setForm} model={model} onSubmit={this.onSubmit} />
          </AuthBody>
        </AuthContentContainer>
        {loadingContents}
        <SignupBottomAction>
          <p>Already have an account?</p>
          <BottomActionButton label="Log in" onClick={this.onLogInClick} tabIndex={1} />
        </SignupBottomAction>
      </AuthContent>
    )
  }

  onLogInClick = () => {
    const { search } = this.props.location
    this.props.dispatch(routerActions.push({ pathname: '/login', search }))
  }

  onSubmit = () => {
    const values = this._form.getModel()
    const { id, action } = signUp(values.username, values.email, values.password)
    this.setState({
      reqId: id,
    })
    this.props.dispatch(action)
  }
}
