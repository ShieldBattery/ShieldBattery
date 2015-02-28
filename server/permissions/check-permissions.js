var httpErrors = require('../http/errors')

module.exports = function(permissions) {
  return function*(next) {
    for (let permission of permissions) {
      if (!this.session.permissions[permission]) {
        throw new httpErrors.ForbiddenError('Not enough permissions')
      }
    }

    yield next
  }
}
