// middleware to add some more secure headers to our responses
export default function() {
  return async function secureHeaders(ctx, next) {
    await next()
    // prevent framing of our page off our domain
    ctx.response.set('X-Frame-Options', 'SAMEORIGIN')
    // prevent content type sniffing
    ctx.response.set('X-Content-Type-Options', 'nosniff')
    // turn on xss protection in IE
    ctx.response.set('X-XSS-Protection', '1; mode=block')
  }
}
