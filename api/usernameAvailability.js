var constants = require('../util/constants')
  , httpErrors = require('../util/http-errors')
  , users = require('../models/users')

module.exports = function(app, baseApiPath) {
  var apiPath = baseApiPath + 'usernameAvailability'
  app.get(apiPath + '/:username', checkAvailability)
}

function checkAvailability(req, res, next) {
  var username = req.params.username
  if (!constants.isValidUsername(username)) {
    return next(new httpErrors.BadRequestError('Invalid username'))
  }

  users.find(username, function(err, user) {
    if (err) {
      req.log.error({ err: err }, 'error finding user')
      next(err)
    } else if (user) {
      next(new httpErrors.NotFoundError('Username not available'))
    } else {
      res.send({ username: username, available: true })
    }
  })
}


