var httpErrors = require('./http-errors')

module.exports = function(permissionsArray) {
  return function(req, res, next) {
    for (var i = 0; i < permissionsArray.length; i++) {
      if (!req.session.permissions[permissionsArray[i]]) {
        return next(new httpErrors.ForbiddenError('Not enough permissions'))
      }
    }
    next()
  }
}
