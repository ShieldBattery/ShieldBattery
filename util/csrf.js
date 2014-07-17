// Inspired by csurf, but usable when sessions are regenerated in the middle of responding to a
// request
var csrfTokens = require('csrf-tokens')

var ignoreMethod =
    { GET: true
    , HEAD: true
    , OPTIONS: true
    }

module.exports = function csrf(options) {
  options = options || {}
  var value = options.value || defaultValue

  var tokens = csrfTokens(options)

  return function(req, res, next){
    // already have one
    var secret
    if (req.session) {
      secret = req.session.csrfSecret
    } else {
      var err = new Error('misconfigured csrf')
      err.status = 500
      return next(err)
    }
    if (secret) return createToken(secret)

    // generate secret
    tokens.secret(function(err, secret){
      if (err) return next(err)

      req.session.csrfSecret = secret
      createToken(secret)
    })

    // generate the token
    function createToken(secret) {
      // lazy-load token
      var token
      req.csrfToken = function csrfToken() {
        return token || (token = tokens.create(secret))
      }

      req.csrfRegen = function(cb) {
        if (req.session.csrfSecret) {
          return cb()
        }

        tokens.secret(function(err, newSecret) {
          if (err) return cb(err)

          req.session.csrfSecret = newSecret
          secret = newSecret // make sure csrfToken() uses the new secret
          token = null
          cb()
        })
      }

      // ignore these methods
      if (ignoreMethod[req.method]) return next()

      // check user-submitted value
      if (!tokens.verify(secret, value(req))) {
        var err = new Error('invalid csrf token')
        err.status = 403
        return next(err)
      }

      next()
    }
  }
}

function defaultValue(req) {
  return (req.body && req.body._csrf) || (req.headers['x-xsrf-token'])
}
