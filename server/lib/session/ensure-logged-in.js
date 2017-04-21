import httpErrors from 'http-errors'

export default async function ensureLoggedIn(ctx, next) {
  if (!ctx.session.userId) {
    throw new httpErrors.Unauthorized()
  }

  await next()
}
