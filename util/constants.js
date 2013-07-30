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
