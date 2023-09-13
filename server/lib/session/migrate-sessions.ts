import { RouterContext } from '@koa/router'
import { Next } from 'koa'
import { findSelfById } from '../users/user-model'

/**
 * Middleware that runs migration code to update outdated sessions to newer formats. Must be placed
 * after the sessions middleware.
 */
export function migrateSessions() {
  return async (ctx: RouterContext, next: Next) => {
    if (ctx.session && (ctx.session as any).userId) {
      // Migrate old-style sessions to the new user field
      const user = await findSelfById((ctx.session as any).userId)
      if (!user) {
        throw new Error('Could not find user for session')
      }
      ctx.session.user = user

      // Delete the old field so we don't try to migrate this session again
      delete (ctx.session as any).userId
    }

    await next()
  }
}
