function validateMinLength(length, msg) {
  return val => ('' + val).length >= length ? null : msg
}

export default validateMinLength
