import httpErrors from 'http-errors'
import redis from '../redis'
import bans from '../models/bans'
import checkPermissions from '../permissions/check-permissions'

export default function(router) {
  router
    .get('/:userId', checkPermissions(['banUsers']), getUserBanHistory)
    .post('/:userId', checkPermissions(['banUsers']), banUser)
}

async function getUserBanHistory(ctx, next) {
  throw new httpErrors.NotImplemented()
}

async function banUser(ctx, next) {
  const userId = ctx.params.userId
  const b = ctx.request.body
  const banParams = {
    banLengthHours: b.banLengthHours,
    reason: b.reason,
  }

  if (!banParams.banLengthHours) {
    // If the ban length is not supplied, we set the ban to 10 years
    banParams.banLengthHours = 10 * 365 * 24 * 60 * 60 * 1000
  }

  try {
    await bans.banUser(userId, ctx.session.userId, ...banParams)
    // Clear all existing sessions for this user
    const userSessionsKey = 'user_sessions:' + userId
    const userSessionIds = await redis.smembers(userSessionsKey)
    for (const sessionId of userSessionIds) {
      await redis.del('koa:sess:' + sessionId)
    }
    await redis.del(userSessionsKey)
  } catch (err) {
    ctx.log.error({ err }, 'error banning the user')
    throw err
  }
}
