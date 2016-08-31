// Returns a validator that executes multiple validators in sequence, returning the first error
// encountered
export function composeValidators(...validators) {
  return async (value, model) => {
    for (const validator of validators) {
      const error = await validator(value, model)
      if (error) {
        return error
      }
    }
    return null
  }
}

export function required(msg) {
  return val => val !== undefined && val !== '' ? null : msg
}

export function minLength(length, msg) {
  return val => ('' + val).length >= length ? null : msg
}

export function maxLength(length, msg) {
  return val => ('' + val).length <= length ? null : msg
}

export function regex(regex, msg) {
  return val => regex.test('' + val) ? null : msg
}

export function matchesOther(otherName, msg) {
  return (val, model) => val === model[otherName] ? null : msg
}

export function numberRange(min, max, msg) {
  return val => {
    const parsed = parseInt(val, 10)
    return (parsed >= min && parsed <= max) ? null : msg
  }
}
