import httpErrors from '../http/errors'

export default function(permissions) {
  return function*(next) {
    for (const permission of permissions) {
      if (!this.session.permissions[permission]) {
        throw new httpErrors.ForbiddenError('Not enough permissions')
      }
    }

    yield next
  }
}
