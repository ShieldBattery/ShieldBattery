import { RouterContext } from '@koa/router'
import Koa from 'koa'

/**
 * Sets the response headers every internal API shares: responses are for a single
 * service-to-service caller and must never be cached or content-sniffed (several internal routes
 * hand back user-uploaded bytes). Intended for `@httpBeforeAll` on `@internalApi` classes.
 */
export async function internalResponseHeaders(ctx: RouterContext, next: Koa.Next) {
  ctx.set('Cache-Control', 'private, no-store')
  ctx.set('X-Content-Type-Options', 'nosniff')
  await next()
}
