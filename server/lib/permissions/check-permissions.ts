import httpErrors from 'http-errors'
import { Context, Next } from 'koa'
import { PermissionName } from '../../../common/users/permissions'

export function checkAllPermissions(...permissions: PermissionName[]) {
  return async function (ctx: Context, next: Next) {
    if (!permissions.every(p => ctx.session?.permissions[p])) {
      throw new httpErrors.Forbidden('Not enough permissions')
    }

    await next()
  }
}

export function checkAnyPermission(...permissions: PermissionName[]) {
  return async function (ctx: Context, next: Next) {
    if (!permissions.some(p => ctx.session?.permissions[p])) {
      throw new httpErrors.Forbidden('Not enough permissions')
    }

    await next()
  }
}
