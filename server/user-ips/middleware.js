// Middleware that tracks user's ip addresses over time. Used to make moderatoring the website
// easier; nothing nefarious, we promise!
import log from '../logging/logger'
import { updateOrInsertUserIp } from '../models/user-ips'

export default function() {
  return async function userIps(ctx, next) {
    if (ctx.session.userId) {
      try {
        await updateOrInsertUserIp(ctx.session.userId, ctx.ip)
      } catch (err) {
        log.error('Error inserting user ip record: ' + { err })
      }
    }
    await next()
  }
}
