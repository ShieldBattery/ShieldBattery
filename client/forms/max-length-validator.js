function validateMaxLength(length, msg) {
  return val => ('' + val).length <= length ? null : msg
}

export default validateMaxLength
