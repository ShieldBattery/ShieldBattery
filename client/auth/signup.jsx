import queryString from 'query-string'
import React from 'react'
import { connect } from 'react-redux'
import styled from 'styled-components'
import {
  EMAIL_MAXLENGTH,
  EMAIL_MINLENGTH,
  EMAIL_PATTERN,
  PASSWORD_MINLENGTH,
  USERNAME_MAXLENGTH,
  USERNAME_MINLENGTH,
  USERNAME_PATTERN,
} from '../../common/constants'
import { openDialog } from '../dialogs/action-creators'
import { DialogType } from '../dialogs/dialog-type'
import form from '../forms/form'
import SubmitOnEnter from '../forms/submit-on-enter'
import {
  composeValidators,
  debounce,
  matchesOther,
  maxLength,
  minLength,
  regex,
  required,
} from '../forms/validators'
import { RaisedButton } from '../material/button'
import CheckBox from '../material/check-box'
import InputError from '../material/input-error'
import { push } from '../navigation/routing'
import { fetchJson } from '../network/fetch'
import LoadingIndicator from '../progress/dots'
import { useAppDispatch } from '../redux-hooks'
import { signUp } from './action-creators'
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
} from './auth-content'
import { redirectIfLoggedIn } from './auth-utils'

const SignupBottomAction = styled(AuthBottomAction)`
  flex-direction: row;
  justify-content: center;

  & > p {
    margin-right: 8px;
  }
`

async function usernameAvailable(val) {
  try {
    const result = await fetchJson(`/api/1/usernameAvailability/${encodeURIComponent(val)}`)
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

const checked = msg => val => val === true ? null : msg

const SignupCheckBox = styled(CheckBox)`
  flex-grow: 1;
`

const MultiCheckBoxFieldRow = styled(FieldRow)`
  margin-top: 0;
`

const DialogLinkElem = styled.a`
  position: relative;
  pointer-events: auto;
  z-index: 1;
`

function DialogLink({ dialogType, text }) {
  const dispatch = useAppDispatch()

  const onClick = event => {
    event.preventDefault()
    event.stopPropagation()
    dispatch(openDialog(dialogType))
  }

  return (
    <DialogLinkElem href='#' onClick={onClick} tabIndex={1}>
      {text}
    </DialogLinkElem>
  )
}

const CheckBoxError = styled(InputError)`
  padding-left: 30px;
  padding-bottom: 4px;
`

function CheckBoxRowWithError({ errorText, ...checkboxProps }) {
  return (
    <>
      <MultiCheckBoxFieldRow>
        <SignupCheckBox {...checkboxProps} />
      </MultiCheckBoxFieldRow>
      {errorText ? <CheckBoxError error={errorText} /> : null}
    </>
  )
}

@form({
  username: usernameValidator,
  email: emailValidator,
  password: passwordValidator,
  confirmPassword: confirmPasswordValidator,
  ageConfirmation: checked('Required'),
  policyAgreement: checked('Required'),
})
class SignupForm extends React.Component {
  render() {
    const { onSubmit, bindCheckable, bindInput } = this.props
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
            {...bindInput('email')}
            inputProps={textInputProps}
            label='Email address'
            floatingLabel={true}
          />
        </FieldRow>

        <FieldRow>
          <AuthPasswordTextField
            {...bindInput('password')}
            inputProps={textInputProps}
            label='Password'
            floatingLabel={true}
          />
        </FieldRow>

        <FieldRow>
          <AuthPasswordTextField
            {...bindInput('confirmPassword')}
            inputProps={textInputProps}
            label='Confirm password'
            floatingLabel={true}
          />
        </FieldRow>

        <CheckBoxRowWithError
          {...bindCheckable('ageConfirmation')}
          label='I certify that I am 13 years of age or older'
          inputProps={{ tabIndex: 1 }}
        />

        <CheckBoxRowWithError
          {...bindCheckable('policyAgreement')}
          label={
            <span>
              I have read and agree to the{' '}
              <DialogLink dialogType={DialogType.TermsOfService} text='Terms of Service' />,{' '}
              <DialogLink dialogType={DialogType.AcceptableUse} text='Acceptable Use' />, and{' '}
              <DialogLink dialogType={DialogType.PrivacyPolicy} text='Privacy' /> policies
            </span>
          }
          inputProps={{ tabIndex: 1 }}
        />

        <FieldRow>
          <RaisedButton label='Create account' onClick={onSubmit} tabIndex={1} />
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

    const model = queryString.parse(window.location.search)
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
          <BottomActionButton label='Log in' onClick={this.onLogInClick} tabIndex={1} />
        </SignupBottomAction>
      </AuthContent>
    )
  }

  onLogInClick = () => {
    const { search } = window.location
    push({ pathname: '/login', search })
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
