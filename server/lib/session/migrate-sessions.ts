import { RouterContext } from '@koa/router'
import { Next } from 'koa'
import { findSelfById } from '../users/user-model'

/**
 * Middleware that runs migration code to update outdated sessions to newer formats. Must be placed
 * after the sessions middleware.
 */
export function migrateSessions() {
  return async (ctx: RouterContext, next: Next) => {
    if (ctx.session) {
      if (ctx.session.userId && !ctx.session.email) {
        const user = await findSelfById(ctx.session.userId)
        ctx.session.email = user!.email
      }
    }

    await next()
  }
}
