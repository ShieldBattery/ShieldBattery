var bcrypt = require('bcrypt')
  , Router = require('express').Router
  , users = require('../models/users')
  , permissions = require('../models/permissions')
  , httpErrors = require('../util/http-errors')
  , initSession = require('../util/init-session')
  , setReturningCookie = require('../util/set-returning-cookie')

module.exports = function() {
  var router = Router()
  router.route('/')
    .get(getCurrentSession)
    .delete(endSession)
    .post(startNewSession)

  return router
}

function getCurrentSession(req, res, next) {
  if (!req.session.userId) return next(new httpErrors.GoneError('Session expired'))
  var userId = req.session.userId

  users.find(userId, function(err, user) {
    if (err) {
      req.log.error({ err: err }, 'error finding user')
      next(err)
    } else if (!user) {
      req.session.regenerate(function(err) {
        if (err) return next(err)

        req.csrfRegen(function(err) {
          if (err) return next(err)
          next(new httpErrors.GoneError('Session expired'))
        })
      })
    } else {
      req.session.touch()
      res.send({user: user, permissions: req.session.permissions})
    }
  })
}

function startNewSession(req, res, next) {
  if (!!req.session.userId) return next(new httpErrors.ConflictError('Session already active'))
  var username = req.body.username
    , password = req.body.password
    , remember = !!req.body.remember
  if (!username || !password) {
    return next(new httpErrors.BadRequestError('Username and password required'))
  }

  users.find(username, function(err, user) {
    if (err) {
      req.log.error({ err: err }, 'error finding user')
      return next(err)
    } else if (!user) {
      return next(new httpErrors.UnauthorizedError('Incorrect username or password'))
    }

    bcrypt.compare(password, user.password, function(err, same) {
      if (err) {
        req.log.error({ err: err }, 'error comparing passwords')
        return next(err)
      }

      if (!same) return next(new httpErrors.UnauthorizedError('Incorrect username or password'))

      regenSession(user)
    })
  })

  function regenSession(user) {
    req.session.regenerate(function(err) {
      if (err) {
        req.log.error({ err: err }, 'error regenerating session')
        return next(err)
      }

      req.csrfRegen(function(err) {
        if (err) return next(err)
        getPermissions(user)
      })
    })
  }

  function getPermissions(user) {
    permissions.get(user.id, function(err, permissions) {
      if (err) {
        req.log.error({ err: err }, 'error getting permissions')
        return next(err)
      }

      initSession(req, user, permissions)
      setReturningCookie(res)
      if (!remember) req.session.cookie.expires = false
      res.send({user: user, permissions: permissions})
    })
  }
}

function endSession(req, res, next) {
  if (!req.session.userId) return next(new httpErrors.ConflictError('No session active'))
  req.session.regenerate(function(err) {
    if (err) {
      next(err)
    } else {
      req.csrfRegen(function(err) {
        if (err) return next(err)
        res.send(200)
      })
    }
  })
}
