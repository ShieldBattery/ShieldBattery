import permissions from '../models/permissions'
import { checkAllPermissions } from '../permissions/check-permissions'

export default function(router) {
  router
    .get('/:userId', checkAllPermissions('editPermissions'), getPermissions)
    .post('/:userId', checkAllPermissions('editPermissions'), updatePermissions)
}

async function getPermissions(ctx, next) {
  const userId = ctx.params.userId

  try {
    ctx.body = await permissions.get(userId)
  } catch (err) {
    ctx.log.error({ err }, 'error querying permissions')
    throw err
  }
}

async function updatePermissions(ctx, next) {
  const b = ctx.request.body
  const userId = ctx.params.userId
  const perms = {
    editPermissions: b.editPermissions,
    debug: b.debug,
    acceptInvites: b.acceptInvites,
    editAllChannels: b.editAllChannels,
    banUsers: b.banUsers,
    manageMaps: b.manageMaps,
  }

  try {
    ctx.body = await permissions.update(userId, perms)
  } catch (err) {
    ctx.log.error({ err }, 'error updating permissions')
    throw err
  }
}
