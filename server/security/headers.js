// middleware to add some more secure headers to our responses
module.exports = function() {
  return function* secureHeaders(next) {
    yield next
    // prevent framing of our page off our domain
    this.response.set('X-Frame-Options', 'SAMEORIGIN')
    // prevent content type sniffing
    this.response.set('X-Content-Type-Options', 'nosniff')
    // turn on xss protection in IE
    this.response.set('X-XSS-Protection', '1; mode=block')
  }
}
