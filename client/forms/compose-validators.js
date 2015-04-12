// Returns a validator that executes multiple validators in sequence, returning the first error
// encountered
function composeValidators(...validators) {
  return val => {
    for (let validator of validators) {
      let error = validator(val)
      if (error) {
        return error
      }
    }

    return null
  }
}

export default composeValidators
