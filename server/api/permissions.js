var permissions = require('../models/permissions')
  , checkPermissions = require('../permissions/check-permissions')

module.exports = function(router) {
  router
    .get('/:userId', checkPermissions(['editPermissions']), getPermissions)
    .post('/:userId', checkPermissions(['editPermissions']), updatePermissions)
}

function* getPermissions(next) {
  let userId = this.params.userId

  try {
    this.body = yield* permissions.get(userId)
  } catch (err) {
    this.log.error({ err: err }, 'error querying permissions')
    throw err
  }
}

function* updatePermissions(next) {
  let b = this.request.body
    , userId = this.params.userId
    , perms = { editPermissions: b.editPermissions
              , debug: b.debug
              , acceptInvites: b.acceptInvites
              }

  try {
    this.body = yield* permissions.update(userId, perms)
  } catch (err) {
    this.log.error({ err: err }, 'error updating permissions')
    throw err
  }
}
