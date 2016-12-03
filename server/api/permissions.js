import permissions from '../models/permissions'
import checkPermissions from '../permissions/check-permissions'

export default function(router) {
  router
    .get('/:userId', checkPermissions(['editPermissions']), getPermissions)
    .post('/:userId', checkPermissions(['editPermissions']), updatePermissions)
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
  }

  try {
    ctx.body = await permissions.update(userId, perms)
  } catch (err) {
    ctx.log.error({ err }, 'error updating permissions')
    throw err
  }
}
