import {
  EMAIL_MAXLENGTH,
  EMAIL_MINLENGTH,
  EMAIL_PATTERN,
  PASSWORD_MINLENGTH,
  USERNAME_MAXLENGTH,
  USERNAME_MINLENGTH,
  USERNAME_PATTERN,
} from '../../common/constants'
import { apiUrl, urlPath } from '../../common/urls'
import {
  RANDOM_EMAIL_CODE_PATTERN,
  UsernameAvailableResponse,
} from '../../common/users/user-network'
import { Validator } from '../forms/form-hook'
import {
  composeValidators,
  debounceValidator,
  matchesOther,
  maxLength,
  minLength,
  regex,
  required,
} from '../forms/validators'
import { fetchJson } from '../network/fetch'

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

export function createUsernameAvailabilityValidator<T>({
  type,
  ignoreName,
}: { type?: 'login' | 'display'; ignoreName?: string } = {}): Validator<string, T> {
  let lastValidatedName: string | undefined
  let lastAvailable = true

  return debounceValidator(async (username, _model, _dirty, t, signal) => {
    if (username === lastValidatedName) {
      return lastAvailable
        ? undefined
        : t('auth.usernameValidator.unavailable', 'Username is not available')
    }
    if (ignoreName && username.toLowerCase() === ignoreName.toLowerCase()) {
      return undefined
    }

    try {
      const result = await fetchJson<UsernameAvailableResponse>(
        apiUrl`users/username-available/${username}` + (type ? urlPath`?type=${type}` : ''),
        {
          method: 'POST',
          signal,
        },
      )
      if (result.available) {
        lastValidatedName = username
        lastAvailable = true
        return undefined
      }
    } catch (ignored) {
      lastValidatedName = undefined
      return t(
        'auth.usernameValidator.availabilityError',
        'There was a problem checking username availability',
      )
    }

    lastValidatedName = username
    lastAvailable = false
    return t('auth.usernameValidator.notAvailable', 'Username is not available')
  }, 350)
}

const CODE_EXAMPLE = 'XXXXX-XXXXX'

export const randomCodeValidator = regex(RANDOM_EMAIL_CODE_PATTERN, t =>
  t('auth.randomCodeValidator.codePattern', {
    defaultValue: 'Invalid code. It should look like {{example}}.',
    example: CODE_EXAMPLE,
  }),
)
