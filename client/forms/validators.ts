import type { TFunction } from 'i18next'
import { AsyncValidator, Validator } from './form-hook'

/**
 * Returns a validator that executes multiple validators in sequence, returning the first error
 * encountered.
 */
export function composeValidators<ValueType, ModelType>(
  ...validators: ReadonlyArray<Validator<ValueType, ModelType>>
): AsyncValidator<ValueType, ModelType> {
  return async (...args) => {
    for (const validator of validators) {
      const error = await validator(...args)
      if (error) {
        return error
      }
    }
    return undefined
  }
}

export function debounceValidator<ValueType, ModelType>(
  validator: Validator<ValueType, ModelType>,
  delayMillis: number,
): Validator<ValueType, ModelType> {
  let timeoutPromise: Promise<string | undefined> | undefined
  let lastValue: Readonly<ValueType> | undefined
  let lastModel: ModelType | undefined
  let lastDirty: ReadonlyMap<keyof ModelType, boolean> | undefined
  let lastT: TFunction | undefined
  return (value, model, dirty, t) => {
    lastValue = value
    lastModel = model
    lastDirty = dirty
    lastT = t
    if (!timeoutPromise) {
      timeoutPromise = new Promise(resolve =>
        setTimeout(() => {
          resolve(validator(lastValue!, lastModel!, lastDirty!, lastT!))
          timeoutPromise = undefined
          lastValue = undefined
          lastModel = undefined
          lastDirty = undefined
          lastT = undefined
        }, delayMillis),
      )
    }

    return timeoutPromise
  }
}

export function required(msg: string | ((t: TFunction) => string)): Validator<any, any> {
  return (val, _model, _dirty, t) => {
    if (val !== undefined && val !== null && (val as any) !== '') {
      return undefined
    }

    return typeof msg === 'function' ? msg(t) : msg
  }
}

export function minLength(length: number): Validator<any, any> {
  return (value, _model, _dirty, t) => {
    if (value === undefined || value === null || ('' + value).length >= length) {
      return undefined
    }

    return t('common.validators.minLength', {
      defaultValue: `Enter at least {{minLength}} characters`,
      minLength: length,
    })
  }
}

export function maxLength(length: number): Validator<any, any> {
  return (value, _model, _dirty, t) => {
    if (value === undefined || value === null || ('' + value).length <= length) {
      return undefined
    }

    return t('common.validators.maxLength', {
      defaultValue: `Enter at most {{maxLength}} characters`,
      maxLength: length,
    })
  }
}

export function regex(
  regex: RegExp,
  msg: string | ((t: TFunction) => string),
): Validator<any, any> {
  return (val, _model, _dirty, t) => {
    if (val === undefined || val === null || regex.test('' + val)) {
      return undefined
    }

    return typeof msg === 'function' ? msg(t) : msg
  }
}

export function matchesOther<ValueType, ModelType>(
  otherName: keyof ModelType,
  msg: string | ((t: TFunction) => string),
): Validator<ValueType, ModelType> {
  return (val, model, _dirty, t) => {
    if (val === model[otherName]) {
      return undefined
    }

    return typeof msg === 'function' ? msg(t) : msg
  }
}

export function requireChecked(): Validator<boolean, any> {
  return (val, _model, _dirty, t) =>
    val === true ? undefined : t('common.validators.required', 'Required')
}
