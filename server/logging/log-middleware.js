var logger = require('./logger.js')
  , uid = require('cuid')

function logMiddleware() {
  return function*(next) {
    var id = this.req._id || uid()
    var startTime = Date.now()

    this.log = logger.child({ reqId: id })
    this.log.info({ req: this.req } , 'request received')

    yield next

    this.res._elapsed = Date.now() - startTime
    this.log.info({ res: this.res }, 'response sent')
  }
}

module.exports = logMiddleware
