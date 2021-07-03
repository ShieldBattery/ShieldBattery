// Returns a validator that executes multiple validators in sequence, returning the first error
// encountered
export function composeValidators(...validators) {
  return async (...args) => {
    for (const validator of validators) {
      const error = await validator(...args)
      if (error) {
        return error
      }
    }
    return null
  }
}

export function debounce(validator, delay) {
  let timeoutPromise
  let lastValue
  let lastModel
  return (value, model) => {
    lastValue = value
    lastModel = model
    if (!timeoutPromise) {
      timeoutPromise = new Promise(resolve =>
        setTimeout(() => {
          resolve(validator(lastValue, lastModel))
          timeoutPromise = null
          lastValue = null
          lastModel = null
        }, delay),
      )
    }

    return timeoutPromise
  }
}

export function required(msg) {
  return val => (val !== undefined && val !== null && val !== '' ? null : msg)
}

export function minLength(
  length,
  msg = `Enter at least ${length} character${length > 1 ? 's' : ''}`,
) {
  return val => (('' + val).length >= length ? null : msg)
}

export function maxLength(
  length,
  msg = `Enter at most ${length} character${length > 1 ? 's' : ''}`,
) {
  return val => (('' + val).length <= length ? null : msg)
}

export function regex(regex, msg) {
  return val => (regex.test('' + val) ? null : msg)
}

export function matchesOther(otherName, msg) {
  return (val, model) => (val === model[otherName] ? null : msg)
}

export function numberRange(min, max, msg) {
  return val => {
    const parsed = parseInt(val, 10)
    return parsed >= min && parsed <= max ? null : msg
  }
}
