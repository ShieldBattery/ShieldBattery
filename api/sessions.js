var bcrypt = require('bcrypt')
  , users = require('../models/users')
  , httpErrors = require('../util/http-errors')

module.exports = function(app, baseApiPath) {
  var sessionsPath = baseApiPath + 'sessions'
  app.get(sessionsPath, getCurrentSession)
  app.post(sessionsPath, startNewSession)
  app.delete(sessionsPath, endSession)
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

        next(new httpErrors.GoneError('Session expired'))
      })
    } else {
      req.session.touch()
      res.send(user)
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
      req.session.regenerate(function(err) {
        if (err) return next(err)

        req.session.userId = user.id
        if (!remember) req.session.cookie.expires = false
        console.log('sending user after login')
        res.send(user)
        console.log('user sent')
      })
    })
  })
}

function endSession(req, res, next) {
  if (!req.session.userId) return next(new httpErrors.ConflictError('No session active'))
  req.session.regenerate(function(err) {
    if (err) next(err)
    else res.send(200)
  })
}
