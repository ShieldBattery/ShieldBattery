import { RouterContext } from '@koa/router'
import { Next } from 'koa'
import { MatchmakingType } from '../../../common/matchmaking'
import { SelfUser } from '../../../common/users/sb-user'
import { findSelfById } from '../users/user-model'

/**
 * Middleware that runs migration code to update outdated sessions to newer formats. Must be placed
 * after the sessions middleware.
 */
export function migrateSessions() {
  return async (ctx: RouterContext, next: Next) => {
    if (ctx.session) {
      let user: SelfUser | undefined

      if (ctx.session.userId && !ctx.session.email) {
        const retrievedUser = user ?? (await findSelfById(ctx.session.userId))
        ctx.session.email = retrievedUser!.email
      }
      if (!ctx.session.lastQueuedMatchmakingType) {
        ctx.session.lastQueuedMatchmakingType = MatchmakingType.Match1v1
      }
      if (ctx.session.userId && !ctx.session.acceptedPrivacyVersion) {
        const retrievedUser = user ?? (await findSelfById(ctx.session.userId))
        ctx.session.acceptedPrivacyVersion = retrievedUser!.acceptedPrivacyVersion
        ctx.session.acceptedTermsVersion = retrievedUser!.acceptedTermsVersion
        ctx.session.acceptedUsePolicyVersion = retrievedUser!.acceptedUsePolicyVersion
      }
    }

    // TODO(tec27): This code can be removed ~2 months after it has been deployed (after all old
    // cookies would have expired)
    if (ctx.sessionId?.startsWith('c') && ctx.sessionId?.length === 25) {
      // CUID session ID, regenerate to get a new (more secure) ID
      const oldSession = ctx.session!
      await ctx.regenerateSession()
      for (const [key, value] of Object.entries(oldSession)) {
        ;(ctx.session as any)[key] = value
      }
    }

    await next()
  }
}
