var logger = require('../logger.js')
  , uid = require('uid2')

function loggerMiddleware() {
  return function(req, res, next) {
    var id = req._id || uid(24)
    req._id = id
    res._id = id

    req._startTime = Date.now()

    req.log = res.log = logger.child({ reqId: id })
    req.log.info({ req: req }, 'request received')
    res.on('finish', function() {
      res._elapsed = Date.now() - req._startTime
      res.log.info({ res: res }, 'response sent')
    })

    next()
  }
}

module.exports = loggerMiddleware
