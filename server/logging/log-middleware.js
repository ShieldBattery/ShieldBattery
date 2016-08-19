import logger from './logger.js'
import uid from 'cuid'

export default function logMiddleware() {
  return async function(ctx, next) {
    const id = ctx.req._id || uid()
    const startTime = Date.now()

    ctx.log = logger.child({ reqId: id })
    ctx.log.info({ req: ctx.req }, 'request received')

    await next()

    ctx.res._elapsed = Date.now() - startTime
    ctx.log.info({ res: ctx.res }, 'response sent')
  }
}
