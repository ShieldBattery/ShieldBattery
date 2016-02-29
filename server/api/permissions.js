import permissions from '../models/permissions'
import checkPermissions from '../permissions/check-permissions'

export default function(router) {
  router
    .get('/:userId', checkPermissions(['editPermissions']), getPermissions)
    .post('/:userId', checkPermissions(['editPermissions']), updatePermissions)
}

function* getPermissions(next) {
  const userId = this.params.userId

  try {
    this.body = yield* permissions.get(userId)
  } catch (err) {
    this.log.error({ err }, 'error querying permissions')
    throw err
  }
}

function* updatePermissions(next) {
  const { permissions: perms } = this.request.body
  const userId = this.params.userId

  try {
    this.body = yield* permissions.update(userId, perms)
  } catch (err) {
    this.log.error({ err }, 'error updating permissions')
    throw err
  }
}
