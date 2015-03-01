module.exports = function() {
  return function* csrfCookie(next) {
    yield next
    this.cookies.set('XSRF-TOKEN', this.csrf, { httpOnly: false })
  }
}
