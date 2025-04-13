import {
  EMAIL_MAXLENGTH,
  EMAIL_MINLENGTH,
  EMAIL_PATTERN,
  PASSWORD_MINLENGTH,
  USERNAME_MAXLENGTH,
  USERNAME_MINLENGTH,
  USERNAME_PATTERN,
} from '../../common/constants'
import {
  composeValidators,
  matchesOther,
  maxLength,
  minLength,
  regex,
  required,
} from '../forms/validators'

export const emailValidator = composeValidators(
  required(t => t('auth.emailValidator.required', 'Enter an email address')),
  minLength(EMAIL_MINLENGTH),
  maxLength(EMAIL_MAXLENGTH),
  regex(EMAIL_PATTERN, t => t('auth.emailValidator.pattern', 'Enter a valid email address')),
)
export const usernameValidator = composeValidators(
  required(t => t('auth.usernameValidator.required', 'Enter a username')),
  minLength(USERNAME_MINLENGTH),
  maxLength(USERNAME_MAXLENGTH),
  regex(USERNAME_PATTERN, t =>
    t('auth.usernameValidator.pattern', 'Username contains invalid characters'),
  ),
)
export const passwordValidator = composeValidators(
  required(t => t('auth.passwordValidator.required', 'Enter a password')),
  minLength(PASSWORD_MINLENGTH),
)
export const confirmPasswordValidator = composeValidators(
  required(t => t('auth.passwordValidator.confirm', 'Confirm your password')),
  matchesOther('password', t => t('auth.passwordValidator.matching', 'Enter a matching password')),
)
