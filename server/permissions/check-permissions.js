import httpErrors from 'http-errors'

export default function(permissions) {
  return function*(next) {
    for (const permission of permissions) {
      if (!this.session.permissions[permission]) {
        throw new httpErrors.Forbidden('Not enough permissions')
      }
    }

    yield next
  }
}
