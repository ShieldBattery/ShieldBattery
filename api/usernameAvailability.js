var constants = require('../util/constants')
  , httpErrors = require('../util/http-errors')
  , users = require('../models/users')
  , Router = require('express').Router

module.exports = function() {
  var router = Router()
  router.route('/:username')
    .get(checkAvailability)

  return router
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


