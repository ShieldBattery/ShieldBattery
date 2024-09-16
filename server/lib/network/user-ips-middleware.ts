// Middleware that tracks user's ip addresses over time. Used to make moderatoring the website
// easier; nothing nefarious, we promise!
import Koa from 'koa'
import { upsertUserIp } from '../users/user-ips.js'

// This middleware must be placed *after* the session middleware in the chain of middlewares
export default function userIpsMiddleware() {
  return async (ctx: Koa.Context, next: Koa.Next) => {
    if (ctx.session?.user) {
      upsertUserIp(ctx.session.user.id, ctx.ip).catch(err => {
        ctx.log.error({ err }, 'Error inserting user ip record')
      })
    }

    await next()
  }
}
