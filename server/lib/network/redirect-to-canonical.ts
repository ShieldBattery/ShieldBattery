import Koa from 'koa'

/** Redirects any requests coming to a non-canonical host to the canonical one. */
export function redirectToCanonical(canonicalHost: string) {
  const asUrl = new URL(canonicalHost)
  const toCompare = asUrl.host.toLowerCase()

  return async function redirectToCanonicalMiddleware(ctx: Koa.Context, next: Koa.Next) {
    const host = ctx.get('Host') ?? ''
    if (host.toLowerCase() !== toCompare) {
      ctx.redirect(`${canonicalHost}${ctx.url}`)
      ctx.status = 308
    } else {
      await next()
    }
  }
}
