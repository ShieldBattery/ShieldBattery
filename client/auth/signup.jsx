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
import { InputError } from '../material/input-error'
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
  FieldRow,
  LoadingArea,
} from './auth-content'
import { redirectIfLoggedIn } from './auth-utils'
import { UserErrorDisplay } from './user-error-display'

// TODO(2Pac): Use the `useTranslation` hook once this is moved over to a functional component. Note
// that I'm using the global version of the `t` function here. react-i18next also exposes a HOC that
// can be used with class components to make the `t` function reactive, but making that work with
// form validators here would be quite cumbersome, so this seemed easier until it gets replaced with
// hooks.
import { Trans } from 'react-i18next'
import { t } from '../i18n/i18next'

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

  return t('auth.usernameValidator.taken', 'Username is already taken')
}

const usernameValidator = composeValidators(
  required(t('auth.usernameValidator.required', 'Enter a username')),
  minLength(
    USERNAME_MINLENGTH,
    t('auth.usernameValidator.minLength2', {
      defaultValue: `Use at least {{minLength}} characters`,
      minLength: USERNAME_MINLENGTH,
    }),
  ),
  maxLength(
    USERNAME_MAXLENGTH,
    t('auth.usernameValidator.maxLength2', {
      defaultValue: `Use at most {{maxLength}} characters`,
      maxLength: USERNAME_MAXLENGTH,
    }),
  ),
  regex(
    USERNAME_PATTERN,
    t('auth.usernameValidator.pattern', 'Username contains invalid characters'),
  ),
  debounce(usernameAvailable, 250),
)
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
    dispatch(openDialog({ type: dialogType }))
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
            label={t('common.literals.username', 'Username')}
            floatingLabel={true}
          />
        </FieldRow>

        <FieldRow>
          <AuthTextField
            {...bindInput('email')}
            inputProps={textInputProps}
            label={t('common.literals.emailAddress', 'Email address')}
            floatingLabel={true}
          />
        </FieldRow>

        <FieldRow>
          <AuthPasswordTextField
            {...bindInput('password')}
            inputProps={textInputProps}
            label={t('common.literals.password', 'Password')}
            floatingLabel={true}
          />
        </FieldRow>

        <FieldRow>
          <AuthPasswordTextField
            {...bindInput('confirmPassword')}
            inputProps={textInputProps}
            label={t('auth.signup.confirmPassword', 'Confirm password')}
            floatingLabel={true}
          />
        </FieldRow>

        <CheckBoxRowWithError
          {...bindCheckable('ageConfirmation')}
          label={t('auth.signup.ageConfirmation', 'I certify that I am 13 years of age or older')}
          inputProps={{ tabIndex: 1 }}
        />

        <CheckBoxRowWithError
          {...bindCheckable('policyAgreement')}
          label={
            <span>
              {t('auth.signup.readAndAgree', 'I have read and agree to the')}{' '}
              <DialogLink
                dialogType={DialogType.TermsOfService}
                text={t('auth.signup.termsOfServiceLink', 'Terms of Service')}
              />
              ,{' '}
              <DialogLink
                dialogType={DialogType.AcceptableUse}
                text={t('auth.signup.acceptableUseLink', 'Acceptable Use')}
              />
              , and{' '}
              <DialogLink
                dialogType={DialogType.PrivacyPolicy}
                text={t('auth.signup.privacyLink', 'Privacy')}
              />{' '}
              policies
            </span>
          }
          inputProps={{ tabIndex: 1 }}
        />

        <FieldRow>
          <RaisedButton
            label={t('auth.signup.createAccount', 'Create account')}
            onClick={onSubmit}
            tabIndex={1}
            testName='submit-button'
          />
        </FieldRow>
      </form>
    )
  }
}

@connect(state => ({ auth: state.auth }))
export default class Signup extends React.Component {
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

    const model = queryString.parse(window.location.search)
    return (
      <AuthContent>
        <AuthContentContainer isLoading={isLoading || authChangeInProgress}>
          <AuthTitle>{t('auth.signup.title', 'Create account')}</AuthTitle>
          <AuthBody>
            {lastError ? <UserErrorDisplay error={lastError} /> : null}
            <SignupForm ref={this._setForm} model={model} onSubmit={this.onSubmit} />
          </AuthBody>
        </AuthContentContainer>
        {loadingContents}
        <SignupBottomAction>
          <p>
            <Trans t={t} i18nKey='auth.signup.alreadyHaveAccount'>
              Already have an account?
            </Trans>
          </p>
          <BottomActionButton
            label={t('common.literals.login', 'Log in')}
            onClick={this.onLogInClick}
            tabIndex={1}
          />
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
    this._abortController?.abort()

    const abortController = (this._abortController = new AbortController())
    this.setState({
      isLoading: true,
      lastError: undefined,
    })
    this.props.dispatch(
      signUp(
        {
          username: values.username,
          email: values.email,
          password: values.password,
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
