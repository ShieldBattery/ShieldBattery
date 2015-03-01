var constants = require('../../shared/constants')
  , httpErrors = require('../http/errors')
  , users = require('../models/users')

module.exports = function(router) {
  router
    .get('/:username', checkAvailability)
}

function* checkAvailability(next) {
  let username = this.params.username
  if (!constants.isValidUsername(username)) {
    throw new httpErrors.BadRequestError('Invalid username')
  }

  let user
  try {
    user = yield* users.find(username)
  } catch (err) {
    this.log.error({ err: err }, 'error finding user')
    throw err
  }

  if (user) {
    throw new httpErrors.NotFoundError('Username not available')
  } else {
    this.body = { username: username, available: true }
  }
}


