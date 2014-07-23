var constants = require('../util/constants')
  , bcrypt = require('bcrypt')
  , createRouter = require('express').Router
  , users = require('../models/users')
  , httpErrors = require('../util/http-errors')
  , initSession = require('../util/init-session')
  , checkPermissions = require('../util/check-permissions')

module.exports = function() {
  var router = createRouter()
  router.post('/', createUser)
    .get('/:searchTerm', checkPermissions(['editPermissions']), find)
    .put('/:id', function(req, res, next) {
      // TODO(tec27): update a user
      next(new httpErrors.ImATeapotError())
    })

  return router
}

function find(req, res, next) {
  console.log('omg')
  var searchTerm = req.params.searchTerm
  users.find(searchTerm, function(err, user) {
    if (err) {
      req.log.error({ err: err }, 'error finding user by name')
      next(err)
    } else if (!user) {
      res.send([])
    } else {
      res.send([ user ])
    }
  })
}

function createUser(req, res, next) {
  var username = req.body.username
    , email = req.body.email
    , password = req.body.password

  if (!constants.isValidUsername(username) ||
      !constants.isValidEmail(email) ||
      !constants.isValidPassword(password)) {
    return next(new httpErrors.BadRequestError('Invalid parameters'))
  }

  bcrypt.hash(password, 10, onHashed)

  function onHashed(err, result) {
    if (err) {
      req.log.error({err: err}, 'error hashing password')
      return next(err)
    }

    var user = users.create(username, email, result)
    user.save(onSaved)
  }

  function onSaved(err, user, permissions) {
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

      req.csrfRegen(function(err) {
        if (err) return next(err)

        initSession(req, user, permissions)
        res.send({user: user, permissions: permissions})
      })
    })
  }
}
