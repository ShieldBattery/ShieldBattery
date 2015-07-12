import logger from './logger.js'
import uid from 'cuid'

export default function logMiddleware() {
  return function*(next) {
    const id = this.req._id || uid()
    const startTime = Date.now()

    this.log = logger.child({ reqId: id })
    this.log.info({ req: this.req }, 'request received')

    yield next

    this.res._elapsed = Date.now() - startTime
    this.log.info({ res: this.res }, 'response sent')
  }
}
