const CORS_MAX_AGE_SECONDS = 60 * 60 * 6

// Koa Middleware to handle CORS headers and pre-flight requests such that our site and app are both
// allowed to make requests to the server.
export function cors() {
  const ALLOWED_ORIGINS = [process.env.SB_CANONICAL_HOST.toLowerCase(), 'shieldbattery://app']

  return async function corsMiddleware(ctx, next) {
    const reqOrigin = ctx.get('Origin')

    // The contents of this response can vary based on the origin provided
    ctx.vary('Origin')

    if (!reqOrigin || !ALLOWED_ORIGINS.includes(reqOrigin)) {
      // The requester either probably doesn't support CORS, or is making a request from somewhere
      // we don't allow (in which case the response will be returned, but their client may not be
      // able to use the contents of it)
      return next()
    }

    if (ctx.method !== 'OPTIONS') {
      // "Normal" requests
      ctx.set('Access-Control-Allow-Origin', reqOrigin)
      ctx.set('Access-Control-Allow-Credentials', 'true')
    } else if (ctx.get('Access-Control-Request-Method')) {
      // Preflight requests
      ctx.set('Access-Control-Allow-Origin', reqOrigin)
      ctx.set('Access-Control-Allow-Credentials', 'true')
      ctx.set('Access-Control-Max-Age', CORS_MAX_AGE_SECONDS)
      ctx.set('Access-Control-Allow-Headers', ctx.get('Access-Control-Request-Headers'))
      ctx.status = 204
      return undefined
    }

    return next()
  }
}
