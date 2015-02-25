var logger = require('./logger.js')
  , uid = require('cuid')

function logMiddleware() {
  return function*(next) {
    var id = req._id || uid()
    var startTime = Date.now()

    this.log = logger.child({ reqId: id })
    this.log.info({ req: req } , 'request received')

    yield next

    this.res._elapsed = Date.now() - startTime
    this.log.info({ res: res }, 'response sent')
  }
}

module.exports = logMiddleware
