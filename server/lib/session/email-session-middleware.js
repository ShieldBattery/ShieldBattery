// Middleware that adds user's email to their sessions, if it doesn't exist already.
// NOTE: This middleware can be kept in production only as long as the session expiration date is
// (which is currently 2 weeks, I think)
import users from '../models/users'
import initSession from './init'
import updateAllSessions from './update-all-sessions'

// This middleware must be placed *after* the session middleware in the chain of middlewares
export default function() {
  return async (ctx, next) => {
    // This has to be executed before router's middleware which sends the user init data. That's why
    // it's done before calling next()
    if (ctx.session.userId && !ctx.session.email) {
      let user
      try {
        user = await users.find(ctx.session.userId)
      } catch (err) {
        ctx.log.error({ err }, 'error finding user')
        throw err
      }

      updateAllSessions(ctx, { email: user.email })
      initSession(ctx, user, ctx.session.permissions)
    }

    await next()
  }
}
