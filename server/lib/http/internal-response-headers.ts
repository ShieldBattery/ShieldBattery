import { RouterContext } from '@koa/router'

/**
 * Sets the response headers every `/internal` route shares: responses are for a single
 * service-to-service caller and must never be cached or content-sniffed (several of these routes
 * hand back user-uploaded bytes).
 */
export function setInternalResponseHeaders(ctx: RouterContext) {
  ctx.set('Cache-Control', 'private, no-store')
  ctx.set('X-Content-Type-Options', 'nosniff')
}
