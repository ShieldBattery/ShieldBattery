// middleware to add some more secure headers to our responses
module.exports = function setSecureHeaders(req, res, next) {
  // prevent framing of our page off our domain
  res.set('X-Frame-Options', 'SAMEORIGIN')
  // prevent content type sniffing
  res.set('X-Content-Type-Options', 'nosniff')
  // turn on xss protection in IE
  res.set('X-XSS-Protection', '1; mode=block')

  next()
}
