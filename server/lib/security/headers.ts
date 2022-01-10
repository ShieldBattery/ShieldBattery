import Koa from 'koa'

// middleware to add some more secure headers to our responses
export default function () {
  return async function secureHeaders(ctx: Koa.Context, next: Koa.Next) {
    try {
      await next()
    } finally {
      // prevent framing of our page off our domain
      ctx.response.set('X-Frame-Options', 'SAMEORIGIN')
      // prevent content type sniffing
      ctx.response.set('X-Content-Type-Options', 'nosniff')
      // turn on xss protection in IE
      ctx.response.set('X-XSS-Protection', '1; mode=block')

      // Set HSTS on secure requests so HTTPS is always used
      if (ctx.secure) {
        // TODO(tec27): Make this `max-age=63072000; includeSubDomains; preload` once we have
        // verified nothing breaks
        ctx.response.set('Strict-Transport-Security', 'max-age=300; includeSubDomains')
      }
    }
  }
}
