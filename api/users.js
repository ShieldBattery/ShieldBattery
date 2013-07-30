var constants = require('../util/constants')
  , db = require('../db')
  , bcrypt = require('bcrypt')

module.exports = function(app, baseApiPath) {
  var usersPath = baseApiPath + 'users'
  app.get(usersPath + '/:id', function(req, res) {
    // TODO(tec27): return user object if authorized
    res.send(418)
  })

  app.post(usersPath, createUser)

  app.put(usersPath + '/:id', function(req, res) {
    // TODO(tec27): update a user
    res.send(418)
  })
}

function createUser(req, res) {
  var username = req.body.username
    , password = req.body.password
    , hashed

  if (!isValidUsername(username) || !isValidPassword(password)) return res.send(400)

  bcrypt.hash(password, 10, onHashed)

  function onHashed(err, result) {
    if (err) {
      console.err('password hashing error', err)
      return res.send(500)
    }

    hashed = result
    db(onDbClient)
  }

  function onDbClient(err, client, done) {
    if (err) {
      console.error('DATABASE ERROR: ', err)
      return res.send(500)
    }

    var query = 'INSERT INTO users (name, password, created) VALUES ($1, $2, $3) ' +
        'RETURNING id, name, created'
      , params = [ username, hashed, new Date() ]
    client.query(query, params, function(err, result) {
      if (err) {
        done()
        if (err.code == 23505) {
          // a user with that name already exists (usually only possible through a race)
          return res.send(409, 'A user with that name already exists')
        } else {
          console.error('QUERY ERROR: ', err)
          return res.send(500)
        }
      } else if (result.rows.length < 1) return res.send(500)

      // regenerate the session to ensure that logged in sessions and anonymous sessions don't
      // share a session ID
      req.session.regenerate(function(err) {
        if (err) return res.send(500)

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
