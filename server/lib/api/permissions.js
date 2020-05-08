import { getPermissions, updatePermissions } from '../models/permissions'
import { checkAllPermissions } from '../permissions/check-permissions'

export default function (router) {
  router
    .get('/:userId', checkAllPermissions('editPermissions'), doGetPermissions)
    .post('/:userId', checkAllPermissions('editPermissions'), doUpdatePermissions)
}

async function doGetPermissions(ctx, next) {
  const userId = ctx.params.userId
  ctx.body = await getPermissions(userId)
}

async function doUpdatePermissions(ctx, next) {
  const userId = ctx.params.userId
  ctx.body = await updatePermissions(userId, ctx.request.body)
}
