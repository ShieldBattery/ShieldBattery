import { Forbidden } from 'http-errors'
import Koa from 'koa'

export default function (canonicalHost: string) {
  return async function checkOrigin(ctx: Koa.Context, next: Koa.Next) {
    // We only check non-GET requests, GET requests don't mutate anything so they're allowed
    // cross-domain (CORS handles content restriction)
    if (ctx.method !== 'GET') {
      const origin = ctx.get('Origin') || ''
      const allowed = origin.startsWith('shieldbattery://') || origin === canonicalHost

      if (!allowed) {
        throw new Forbidden('Invalid origin for this request')
      }
    }

    return next()
  }
}
