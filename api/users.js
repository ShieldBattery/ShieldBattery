var constants = require('../util/constants')
  , bcrypt = require('bcrypt')
  , users = require('../models/users')
  , httpErrors = require('../util/http-errors')
  , initSession = require('../util/init-session')

module.exports = function(app, baseApiPath) {
  var usersPath = baseApiPath + 'users'
  app.get(usersPath + '/:id', function(req, res, next) {
    // TODO(tec27): return user object if authorized
    next(new httpErrors.ImATeapotError())
  })

  app.post(usersPath, createUser)

  app.put(usersPath + '/:id', function(req, res, next) {
    // TODO(tec27): update a user
    next(new httpErrors.ImATeapotError())
  })
}

function createUser(req, res, next) {
  var username = req.body.username
    , password = req.body.password

  if (!constants.isValidUsername(username) || !constants.isValidPassword(password)) {
    return next(new httpErrors.BadRequestError('Invalid username or password'))
  }

  bcrypt.hash(password, 10, onHashed)

  function onHashed(err, result) {
    if (err) {
      req.log.error({err: err}, 'error hashing password')
      return next(err)
    }

    var user = users.create(username, result)
    user.save(onSaved)
  }

  function onSaved(err, user) {
    if (err) {
      if (err.code && err.code == 23505) {
        // TODO(tec27): this is a nasty check, we should find a better way of dealing with this
        // a user with that name already exists
        return next(new httpErrors.ConflictError('A user with that name already exists'))
      }
      req.log.error({ err: err }, 'error saving user')
      return next(err)
    }

    // regenerate the session to ensure that logged in sessions and anonymous sessions don't
    // share a session ID
    req.session.regenerate(function(err) {
      if (err) return next(err)

      initSession(req, user)
      res.send(user)
    })
  }
}
