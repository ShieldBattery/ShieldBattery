import httpErrors from 'http-errors'

export function checkAllPermissions(...permissions) {
  return async function(ctx, next) {
    if (!permissions.every(p => ctx.session.permissions[p])) {
      throw new httpErrors.Forbidden('Not enough permissions')
    }

    await next()
  }
}

export function checkAnyPermission(...permissions) {
  return async function(ctx, next) {
    if (!permissions.some(p => ctx.session.permissions[p])) {
      throw new httpErrors.Forbidden('Not enough permissions')
    }

    await next()
  }
}
