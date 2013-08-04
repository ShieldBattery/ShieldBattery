// modified csrf middleware to better handle regenerating sessions during request handling, and
// setting/getting Angular's XSRF cookie/header
var uid = require('uid2')
  , http = require('http')

module.exports = function csrf(options) {
  options = options || {}
  var value = options.value || defaultValue
    , setter = options.setter || defaultSetter

  return function doCsrf(req, res, next) {
    res.on('header', function() {
      setter(req, res, getToken(req, true))
    })

    var token = getToken(req, false) // need to do this here to ensure every request has a token set
    if (req.method == 'GET' || req.method == 'HEAD' || req.method == 'OPTIONS') return next()

    var val = value(req)
    if (val != token) {
      res.statusCode = 403
      res.end(http.STATUS_CODES[403])
      return
    }

    next()
  }

  function getToken(req, needsSave) {
    if (!req.session._csrf) {
      req.session._csrf = uid(24)
      // if the csrf gets regenerated while sending headers, it won't be automatically saved by
      // the session middleware, so we need to manually trigger the save
      if (needsSave) {
        req.session.save(function(err) {
          if (err) req.log.error({ err: err }, 'error saving session')
        })
      }
    }
    return req.session._csrf
  }

  function defaultValue(req) {
    return (
        (req.headers['x-xsrf-token']) ||
        (req.body && req.body._csrf) ||
        (req.query && req.query._csrf)
    )
  }

  function defaultSetter(req, res, token) {
    // only send the cookie if they don't already have it
    if (req.cookies['XSRF-TOKEN'] != token) res.cookie('XSRF-TOKEN', token)
  }
}
