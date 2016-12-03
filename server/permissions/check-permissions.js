import httpErrors from 'http-errors'

export default function(permissions) {
  return async function(ctx, next) {
    for (const permission of permissions) {
      if (!ctx.session.permissions[permission]) {
        throw new httpErrors.Forbidden('Not enough permissions')
      }
    }

    await next()
  }
}
