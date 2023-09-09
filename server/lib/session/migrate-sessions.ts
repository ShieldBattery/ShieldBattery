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
    if (ctx.session && ctx.session.userId) {
      let retrievedUser: SelfUser | undefined

      if (!ctx.session.email) {
        retrievedUser = retrievedUser ?? (await findSelfById(ctx.session.userId))
        ctx.session.email = retrievedUser!.email
      }
      if (!ctx.session.lastQueuedMatchmakingType) {
        ctx.session.lastQueuedMatchmakingType = MatchmakingType.Match1v1
      }
      if (!ctx.session.acceptedPrivacyVersion) {
        retrievedUser = retrievedUser ?? (await findSelfById(ctx.session.userId))
        ctx.session.acceptedPrivacyVersion = retrievedUser!.acceptedPrivacyVersion
        ctx.session.acceptedTermsVersion = retrievedUser!.acceptedTermsVersion
        ctx.session.acceptedUsePolicyVersion = retrievedUser!.acceptedUsePolicyVersion
      }
      if (!ctx.session.locale) {
        retrievedUser = retrievedUser ?? (await findSelfById(ctx.session.userId))
        ctx.session.locale = retrievedUser!.locale
      }
      if (!ctx.session.loginName) {
        retrievedUser = retrievedUser ?? (await findSelfById(ctx.session.userId))
        ctx.session.loginName = retrievedUser!.loginName
      }
    }

    await next()
  }
}
