var db = require('../db')

module.exports = function(app, baseApiPath) {
  var sessionsPath = baseApiPath + 'sessions'
  app.get(sessionsPath, getCurrentSession)
  app.post(sessionsPath, startNewSession)
}

function getCurrentSession(req, res) {
  // this check is explicit to avoid returning false for userId = 0
  if (req.session.userId == null) return res.send(410)
  var userId = req.session.userId

  db(function(err, client, done) {
    if (err) {
      console.error('DATABASE ERROR: ', err)
      return res.send(500)
    }

    // TODO(tec27): this sort of query should probably be pulled out into a models file or something
    // so that we don't have to keep all of the user queries in sync every time the table changes
    var query = 'SELECT id, name, created FROM users WHERE id = $1'
    client.query(query, [ userId ], function(err, result) {
      done()
      if (err) {
        console.error('QUERY ERROR: ', err)
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

}
