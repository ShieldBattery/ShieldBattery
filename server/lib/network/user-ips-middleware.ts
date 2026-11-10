// Middleware that tracks user's ip addresses over time. Used to make moderatoring the website
// easier; nothing nefarious, we promise!
import Koa from 'koa'
import { container } from 'tsyringe'
import { UserIpTracker } from '../users/user-ip-tracker'

// This middleware must be placed *after* the session middleware in the chain of middlewares
export default function userIpsMiddleware() {
  const tracker = container.resolve(UserIpTracker)

  return async (ctx: Koa.Context, next: Koa.Next) => {
    if (ctx.session?.user) {
      tracker.record(ctx.session.user.id, ctx.ip)
    }

    await next()
  }
}
