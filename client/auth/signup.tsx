import queryString from 'query-string'
import React, { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
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
import { useForm } from '../forms/form-hook'
import SubmitOnEnter from '../forms/submit-on-enter'
import {
  composeValidators,
  debounce,
  matchesOther,
  maxLength,
  minLength,
  regex,
  requireChecked,
  required,
} from '../forms/validators'
import { detectedLocale } from '../i18n/i18next'
import { RaisedButton } from '../material/button'
import CheckBox from '../material/check-box'
import { InputError } from '../material/input-error'
import { push } from '../navigation/routing'
import { fetchJson } from '../network/fetch'
import LoadingIndicator from '../progress/dots'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { useStableCallback } from '../state-hooks'
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

const SignupBottomAction = styled(AuthBottomAction)`
  flex-direction: row;
  justify-content: center;

  & > p {
    margin-right: 8px;
  }
`

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

function DialogLink({
  dialogType,
  text,
}: {
  dialogType: DialogType.TermsOfService | DialogType.AcceptableUse | DialogType.PrivacyPolicy
  text: string
}) {
  const dispatch = useAppDispatch()

  const onClick = (event: React.MouseEvent) => {
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

// TODO(2Pac): Move this to the Checkbox file once that's TS-ified
interface CheckboxProps {
  name: string
  checked: boolean
  label: React.ReactNode
  value?: string
  disabled?: boolean
  className?: string
  inputProps?: React.InputHTMLAttributes<HTMLInputElement>
  onChange: (event: React.ChangeEvent<HTMLInputElement>) => void
}

function CheckBoxRowWithError({
  errorText,
  ...checkboxProps
}: { errorText?: string } & CheckboxProps) {
  return (
    <>
      <MultiCheckBoxFieldRow>
        <SignupCheckBox {...checkboxProps} />
      </MultiCheckBoxFieldRow>
      {errorText ? <CheckBoxError error={errorText} /> : null}
    </>
  )
}

interface SignupModel {
  username: string
  email: string
  password: string
  confirmPassword: string
  ageConfirmation: boolean
  policyAgreement: boolean
}

export function Signup() {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const auth = useAppSelector(s => s.auth)

  const [isLoading, setIsLoading] = useState(false)
  const [lastError, setLastError] = useState<Error>()

  useEffect(() => {
    redirectIfLoggedIn({ auth })
  }, [auth])

  const usernameAvailable = useRef(
    debounce(async (username: string) => {
      try {
        // TODO(2Pac): Share the response type here with the server API once that's moved to the new
        // API setup.
        const result = await fetchJson<{ username: string; available: boolean }>(
          `/api/1/usernameAvailability/${encodeURIComponent(username)}`,
        )
        if (result.available) {
          return null
        }
      } catch (ignored) {
        // TODO(tec27): handle non-404 errors differently
      }

      return t('auth.usernameValidator.taken', 'Username is already taken')
    }, 250),
  )

  const abortControllerRef = useRef<AbortController>()

  const onFormSubmit = useStableCallback((model: SignupModel) => {
    setIsLoading(true)
    setLastError(undefined)

    abortControllerRef.current?.abort()
    abortControllerRef.current = new AbortController()

    dispatch(
      signUp(
        {
          username: model.username,
          email: model.email,
          password: model.password,
          locale: detectedLocale.getValue(),
        },
        {
          onSuccess: () => {},
          onError: err => {
            setIsLoading(false)
            setLastError(err)
          },
          signal: abortControllerRef.current.signal,
        },
      ),
    )
  })

  const queryModel: { username?: string } = queryString.parse(window.location.search)
  const { onSubmit, bindInput, bindCheckable } = useForm<SignupModel>(
    {
      username: queryModel.username ?? '',
      email: '',
      password: '',
      confirmPassword: '',
      ageConfirmation: false,
      policyAgreement: false,
    },
    {
      username: composeValidators(
        required(t('auth.usernameValidator.required', 'Enter a username')),
        minLength(
          USERNAME_MINLENGTH,
          t('common.validators.minLength', {
            defaultValue: `Enter at least {{minLength}} characters`,
            minLength: USERNAME_MINLENGTH,
          }),
        ),
        maxLength(
          USERNAME_MAXLENGTH,
          t('common.validators.maxLength', {
            defaultValue: `Enter at most {{maxLength}} characters`,
            maxLength: USERNAME_MAXLENGTH,
          }),
        ),
        regex(
          USERNAME_PATTERN,
          t('auth.usernameValidator.pattern', 'Username contains invalid characters'),
        ),
        usernameAvailable.current,
      ),
      email: composeValidators(
        required(t('auth.emailValidator.required', 'Enter an email address')),
        minLength(
          EMAIL_MINLENGTH,
          t('common.validators.minLength', {
            defaultValue: `Enter at least {{minLength}} characters`,
            minLength: EMAIL_MINLENGTH,
          }),
        ),
        maxLength(
          EMAIL_MAXLENGTH,
          t('common.validators.maxLength', {
            defaultValue: `Enter at most {{maxLength}} characters`,
            maxLength: EMAIL_MAXLENGTH,
          }),
        ),
        regex(EMAIL_PATTERN, t('auth.emailValidator.pattern', 'Enter a valid email address')),
      ),
      password: composeValidators(
        required(t('auth.passwordValidator.required', 'Enter a password')),
        minLength(
          PASSWORD_MINLENGTH,
          t('common.validators.minLength', {
            defaultValue: `Enter at least {{minLength}} characters`,
            minLength: PASSWORD_MINLENGTH,
          }),
        ),
      ),
      confirmPassword: composeValidators(
        required(t('auth.passwordValidator.confirm', 'Confirm your password')),
        matchesOther('password', t('auth.passwordValidator.matching', 'Enter a matching password')),
      ),
      ageConfirmation: requireChecked(t('auth.ageConfirmation.required', 'Required')),
      policyAgreement: requireChecked(t('auth.policyAgreement.required', 'Required')),
    },
    { onSubmit: onFormSubmit },
  )

  const onLogInClick = useStableCallback(() => {
    const { search } = window.location
    push({ pathname: '/login', search })
  })

  let loadingContents
  if (auth.authChangeInProgress || isLoading) {
    loadingContents = (
      <LoadingArea>
        <LoadingIndicator />
      </LoadingArea>
    )
  }

  const textInputProps = {
    autoCapitalize: 'off',
    autoCorrect: 'off',
    spellCheck: false,
    tabIndex: 1,
  }

  return (
    <AuthContent>
      <AuthContentContainer isLoading={isLoading || auth.authChangeInProgress}>
        <AuthTitle>{t('auth.signup.title', 'Create account')}</AuthTitle>
        <AuthBody>
          {lastError ? <UserErrorDisplay error={lastError} /> : null}
          <form noValidate={true} onSubmit={onSubmit}>
            <SubmitOnEnter />
            <FieldRow>
              <AuthTextField
                {...bindInput('username')}
                inputProps={textInputProps}
                label={t('auth.signup.username', 'Username')}
                floatingLabel={true}
              />
            </FieldRow>

            <FieldRow>
              <AuthTextField
                {...bindInput('email')}
                inputProps={textInputProps}
                label={t('auth.signup.emailAddress', 'Email address')}
                floatingLabel={true}
              />
            </FieldRow>

            <FieldRow>
              <AuthPasswordTextField
                {...bindInput('password')}
                inputProps={textInputProps}
                label={t('auth.signup.password', 'Password')}
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
              label={t(
                'auth.signup.ageConfirmation',
                'I certify that I am 13 years of age or older',
              )}
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
        </AuthBody>
      </AuthContentContainer>

      {loadingContents}

      <SignupBottomAction>
        <p>{t('auth.signup.alreadyHaveAccount', 'Already have an account?')}</p>
        <BottomActionButton
          label={t('auth.signup.logIn', 'Log in')}
          onClick={onLogInClick}
          tabIndex={1}
        />
      </SignupBottomAction>
    </AuthContent>
  )
}
