import { STATUS_CODES } from 'http'
import Koa from 'koa'

const isDev = process.env.NODE_ENV !== 'production'

/**
 * A Koa middleware that allows Errors to specify a payload to include on the response body. This is
 * a simplified/modified version of what koa-error typically does.
 */
export function errorPayloadMiddleware() {
  return async function (ctx: Koa.Context, next: Koa.Next) {
    try {
      await next()
      if (ctx.response.status === 404 && !ctx.response.body) ctx.throw(404)
    } catch (err: any) {
      ctx.status = typeof err.status === 'number' ? err.status : 500

      ctx.app.emit('error', err, ctx)

      switch (ctx.accepts('json', 'text')) {
        case 'json':
          ctx.type = 'application/json'
          if (err.expose) {
            if (err.payload) {
              ctx.body = err.payload
            } else {
              const { cause: _cause, ...errWithoutCause } = err
              ctx.body = { error: err.message, originalError: errWithoutCause }
            }
          } else if (isDev) {
            ctx.body = { error: err.message, originalError: err }
          } else {
            ctx.body = { error: STATUS_CODES[ctx.status] }
          }
          break

        default:
          ctx.type = 'text/plain'
          if (isDev) {
            ctx.body = err.message
          } else if (err.expose) {
            ctx.body = err.message
          } else {
            ctx.body = STATUS_CODES[ctx.status]
          }
      }
    }
  }
}
