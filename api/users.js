var constants = require('../util/constants')
  , db = require('../db')
  , bcrypt = require('bcrypt')
  , httpErrors = require('../util/http-errors')

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
    , hashed

  if (!isValidUsername(username) || !isValidPassword(password)) {
    return next(new httpErrors.BadRequestError('Invalid username or password'))
  }

  bcrypt.hash(password, 10, onHashed)

  function onHashed(err, result) {
    if (err) {
      req.log.error({err: err}, 'error hashing password')
      return next(err)
    }

    hashed = result
    db(onDbClient)
  }

  function onDbClient(err, client, done) {
    if (err) {
      req.log.error({err: err}, 'error getting database client')
      return next(err)
    }

    var query = 'INSERT INTO users (name, password, created) VALUES ($1, $2, $3) ' +
        'RETURNING id, name, created'
      , params = [ username, hashed, new Date() ]
    client.query(query, params, function(err, result) {
      if (err) {
        done()
        if (err.code == 23505) {
          // a user with that name already exists (usually only possible through a race)
          return next(new httpErrors.ConflictError('A user with that name already exists'))
        } else {
          req.log.error({err: err}, 'error querying database')
          return next(err)
        }
      } else if (result.rows.length < 1) return next(err)

      // regenerate the session to ensure that logged in sessions and anonymous sessions don't
      // share a session ID
      req.session.regenerate(function(err) {
        if (err) return next(err)

        req.session.userId = result.rows[0].id
        res.send(result.rows[0])
      })
    })
  }
}

function isValidUsername(username) {
  return username &&
      username.length >= constants.USERNAME_MINLENGTH &&
      username.length <= constants.USERNAME_MAXLENGTH &&
      constants.USERNAME_PATTERN.test(username)
}

function isValidPassword(password) {
  return password &&
      password.length >= constants.PASSWORD_MINLENGTH
}
