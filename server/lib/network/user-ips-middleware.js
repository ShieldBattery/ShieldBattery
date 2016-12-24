// Middleware that tracks user's ip addresses over time. Used to make moderatoring the website
// easier; nothing nefarious, we promise!
import { updateOrInsertUserIp } from '../models/user-ips'

// This middleware must be placed *after* the session middleware in the chain of middlewares
export default function() {
  return async (ctx, next) => {
    if (ctx.session.userId) {
      updateOrInsertUserIp(ctx.session.userId, ctx.ip).catch(err => {
        ctx.log.error({ err }, 'Error inserting user ip record')
      })
    }

    await next()
  }
}
