// common constants, shared between multiple pieces of code (and likely client and server)
function d(name, value) {
  Object.defineProperty(module.exports, name, { value, enumerable: true })
}

d('USERNAME_PATTERN', /^[A-Za-z0-9`~!$^&*()[\]\-_+=.{}]+$/)
d('USERNAME_MINLENGTH', 3)
d('USERNAME_MAXLENGTH', 16)

d('EMAIL_PATTERN', /^[^@]+@[^@]+$/)
d('EMAIL_MINLENGTH', 3)
d('EMAIL_MAXLENGTH', 100)

d('PASSWORD_MINLENGTH', 6)

d('PORT_MIN_NUMBER', 0)
d('PORT_MAX_NUMBER', 65535)

module.exports.isValidUsername = function(username) {
  return username &&
    username.length >= module.exports.USERNAME_MINLENGTH &&
    username.length <= module.exports.USERNAME_MAXLENGTH &&
    module.exports.USERNAME_PATTERN.test(username)
}

module.exports.isValidEmail = function(email) {
  return email &&
    email.length >= module.exports.EMAIL_MINLENGTH &&
    email.length <= module.exports.EMAIL_MAXLENGTH &&
    module.exports.EMAIL_PATTERN.test(email)
}

module.exports.isValidPassword = function(password) {
  return password &&
      password.length >= module.exports.PASSWORD_MINLENGTH
}
