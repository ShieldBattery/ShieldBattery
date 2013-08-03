var db = require('../db')
  , bcrypt = require('bcrypt')
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

  db(function(err, client, done) {
    if (err) {
      req.log.error({err: err}, 'error getting database client')
      return next(err)
    }

    // TODO(tec27): this sort of query should probably be pulled out into a models file or something
    // so that we don't have to keep all of the user queries in sync every time the table changes
    var query = 'SELECT id, name, created FROM users WHERE id = $1'
    client.query(query, [ userId ], function(err, result) {
      done()
      if (err) {
        req.log.error({err: err}, 'error querying database')
        return next(err)
      }

      if(result.rows.length < 1) {
        req.session.regenerate(function(err) {
          if (err) return next(err)
          else return next(new httpErrors.GoneError('Session expired'))
        })
      } else {
        req.session.touch()
        res.send(result.rows[0])
      }
    })
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

  var user

  db(function(err, client, done) {
    if (err) {
      req.log.error({err: err}, 'error getting database client')
      return next(err)
    }

    var query = 'SELECT id, name, password, created FROM users WHERE name = $1'
      , params = [ username ]
    client.query(query, params, function(err, result) {
      done()
      if (err) {
        req.log.error({err: err}, 'error querying database')
        return next(err)
      } else if (result.rows.length < 1) {
        return next(new httpErrors.UnauthorizedError('Incorrect username or password'))
      }

      user = result.rows[0]
      bcrypt.compare(password, user.password, onCompared)
    })
  })

  function onCompared(err, same) {
    if (err) {
      req.log.error({err: err}, 'error comparing passwords')
      return next(err)
    }

    if (!same) return next(new httpErrors.UnauthorizedError('Incorrect username or password'))
    var sessionUser = { id: user.id, name: user.name, created: user.created }
    req.session.regenerate(function(err) {
      if (err) return next(err)

      req.session.userId = sessionUser.id
      if (!remember) req.session.cookie.expires = false
      res.send(sessionUser)
    })
  }
}

function endSession(req, res, next) {
  if (!req.session.userId) return next(new httpErrors.ConflictError('No session active'))
  req.session.regenerate(function(err) {
    if (err) next(err)
    else res.send(200)
  })
}
