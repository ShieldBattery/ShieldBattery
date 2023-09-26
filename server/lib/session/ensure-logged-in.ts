import httpErrors from 'http-errors'
import Koa from 'koa'

export default async function ensureLoggedIn(ctx: Koa.Context, next: Koa.Next) {
  if (!ctx.session) {
    throw new httpErrors.Unauthorized()
  }

  await next()
}
