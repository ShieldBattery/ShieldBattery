var db = require('../db')
  , bcrypt = require('bcrypt')

module.exports = function(app, baseApiPath) {
  var sessionsPath = baseApiPath + 'sessions'
  app.get(sessionsPath, getCurrentSession)
  app.post(sessionsPath, startNewSession)
  app.delete(sessionsPath, endSession)
}

function getCurrentSession(req, res) {
  if (!req.session.userId) return res.send(410)
  var userId = req.session.userId

  db(function(err, client, done) {
    if (err) {
      req.log.error({err: err}, 'error getting database client')
      return res.send(500)
    }

    // TODO(tec27): this sort of query should probably be pulled out into a models file or something
    // so that we don't have to keep all of the user queries in sync every time the table changes
    var query = 'SELECT id, name, created FROM users WHERE id = $1'
    client.query(query, [ userId ], function(err, result) {
      done()
      if (err) {
        req.log.error({err: err}, 'error querying database')
        return res.send(500)
      }

      if(result.rows.length < 1) {
        req.session.regenerate(function(err) {
          if (err) res.send(500)
          else res.send(410)
        })
      } else {
        req.session.touch()
        res.send(result.rows[0])
      }
    })
  })
}

function startNewSession(req, res) {
  if (!!req.session.userId) return res.send(409)
  var username = req.body.username
    , password = req.body.password
    , remember = !!req.body.remember
  if (!username || !password) return res.send(400)

  var user

  db(function(err, client, done) {
    if (err) {
      req.log.error({err: err}, 'error getting database client')
      return res.send(500)
    }

    var query = 'SELECT id, name, password, created FROM users WHERE name = $1'
      , params = [ username ]
    client.query(query, params, function(err, result) {
      done()
      if (err) {
        req.log.error({err: err}, 'error querying database')
        return res.send(500)
      } else if (result.rows.length < 1) return res.send(401)

      user = result.rows[0]
      bcrypt.compare(password, user.password, onCompared)
    })
  })

  function onCompared(err, same) {
    if (err) {
      req.log.error({err: err}, 'error comparing passwords')
      return res.send(500)
    }

    if (!same) return res.send(401)
    var sessionUser = { id: user.id, name: user.name, created: user.created }
    req.session.regenerate(function(err) {
      if (err) return res.send(500)

      req.session.userId = sessionUser.id
      if (!remember) req.session.cookie.expires = false
      res.send(sessionUser)
    })
  }
}

function endSession(req, res) {
  if (!req.session.userId) return res.send(409)
  req.session.regenerate(function(err) {
    if (err) res.send(500)
    else res.send(200)
  })
}
