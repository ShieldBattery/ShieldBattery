import { IncomingMessage } from 'http'
import Koa from 'koa'
import vary from 'vary'

export const CORS_MAX_AGE_SECONDS = 60 * 60 * 6

const APP_ORIGIN = 'shieldbattery://app'
// Read on first use rather than at import, since not everything that imports this module runs with
// the server's environment.
let siteOrigin: string | undefined

/** Returns whether an `Origin` header value is one our site or app makes requests from. */
function isAllowedOrigin(origin: string | undefined): boolean {
  siteOrigin ??= process.env.SB_CANONICAL_HOST!.toLowerCase()
  return origin === siteOrigin || origin === APP_ORIGIN
}

/**
 * Returns whether a request is a browser asking permission for a cross-origin request it is about
 * to make, rather than a request for anything itself.
 */
function isCorsPreflight(req: IncomingMessage): boolean {
  return req.method === 'OPTIONS' && !!req.headers['access-control-request-method']
}

/** Returns whether a request is a CORS preflight that `cors()` approves. */
export function isApprovedCorsPreflight(req: IncomingMessage): boolean {
  return isCorsPreflight(req) && isAllowedOrigin(req.headers.origin)
}

// Koa Middleware to handle CORS headers and pre-flight requests such that our site and app are both
// allowed to make requests to the server.
//
// Preflights are answered here without reaching anything later in the chain, so the earlier this
// is mounted the less each one costs. The app sends one ahead of nearly every API request it
// hasn't made recently.
export function cors() {
  return async function corsMiddleware(ctx: Koa.Context, next: Koa.Next) {
    const reqOrigin = ctx.get('Origin')

    // The contents of this response can vary based on the origin provided
    ctx.vary('Origin')

    if (!isAllowedOrigin(reqOrigin)) {
      // The requester either probably doesn't support CORS, or is making a request from somewhere
      // we don't allow (in which case the response will be returned, but their client may not be
      // able to use the contents of it)
      return next()
    }

    if (ctx.method !== 'OPTIONS') {
      // "Normal" requests
      try {
        ctx.set('Access-Control-Allow-Origin', reqOrigin)
        ctx.set('Access-Control-Allow-Credentials', 'true')
        return next()
      } catch (err: any) {
        // Ensure errors are still accessible to the requester
        const errHeaders = err.headers ?? {}
        const varyWithOrigin = vary.append(errHeaders.vary ?? errHeaders.Vary ?? '', 'Origin')
        delete errHeaders.Vary

        err.headers = {
          ...errHeaders,
          'Access-Control-Allow-Origin': reqOrigin,
          'Access-Control-Allow-Credentials': true,
          vary: varyWithOrigin,
        }

        throw err
      }
    } else if (isCorsPreflight(ctx.req)) {
      // Preflight requests
      ctx.set('Access-Control-Allow-Origin', reqOrigin)
      ctx.set('Access-Control-Allow-Credentials', 'true')
      ctx.set('Access-Control-Allow-Methods', 'DELETE,GET,HEAD,PATCH,POST,PUT')
      ctx.set('Access-Control-Max-Age', String(CORS_MAX_AGE_SECONDS))

      if (ctx.get('Access-Control-Request-Headers')) {
        ctx.vary('Access-Control-Request-Headers')
        ctx.set('Access-Control-Allow-Headers', ctx.get('Access-Control-Request-Headers'))
      }

      ctx.status = 204
      return undefined
    }

    return next()
  }
}
