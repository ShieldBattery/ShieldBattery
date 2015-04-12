function validateRegex(regex, msg) {
  return val => regex.test('' + val) ? null : msg
}

export default validateRegex
