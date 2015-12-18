// Returns a validator that executes multiple validators in sequence, returning the first error
// encountered
function composeValidators(...validators) {
  return val => {
    for (const validator of validators) {
      const error = validator(val)
      if (error) {
        return error
      }
    }

    return null
  }
}

export default composeValidators
