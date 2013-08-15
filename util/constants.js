// common constants, shared between multiple pieces of code (and likely client and server)
function d(name, value) {
  Object.defineProperty(module.exports, name,
      { value: value
      , enumerable: true
      })
}

d('USERNAME_PATTERN', /^[A-Za-z0-9`~!$^&*()[\]\-_+=.{}]+$/)
d('USERNAME_MINLENGTH', 3)
d('USERNAME_MAXLENGTH', 16)

d('PASSWORD_MINLENGTH', 6)

module.exports.isValidUsername = function(username) {
  return username &&
    username.length >= module.exports.USERNAME_MINLENGTH &&
    username.length <= module.exports.USERNAME_MAXLENGTH &&
    module.exports.USERNAME_PATTERN.test(username) 
}

module.exports.isValidPassword = function(password) {
  return password &&
      password.length >= constants.PASSWORD_MINLENGTH
}
