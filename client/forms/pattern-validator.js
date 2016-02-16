function validatePattern(pattern, msg) {
  return val => ('' + val).match(pattern) ? null : msg
}

export default validatePattern
