import httpErrors from 'http-errors'
import Koa from 'koa'

export default async function ensureLoggedIn(ctx: Koa.Context, next: Koa.Next) {
  if (!ctx.session?.user) {
    throw new httpErrors.Unauthorized()
  }

  await next()
}
