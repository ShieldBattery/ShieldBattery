module.exports = function() {
  return function*(next) {
    yield next
    this.cookies.set('XSRF-TOKEN', this.csrf)
  }
}
