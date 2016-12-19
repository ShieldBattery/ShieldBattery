import httpErrors from 'http-errors'
import Redis from 'ioredis'
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
    length: b.length,
    bannedBy: b.bannedBy,
    reason: b.reason,
  }

  if (!banParams.length || !banParams.bannedBy) {
    throw new httpErrors.BadRequest('Invalid parameters')
  }

  try {
    const redis = new Redis()
    await bans.ban(userId, ...banParams)
    // Clear all existing sessions for this user
    const userSessionsKey = 'user_sessions:' + ctx.session.userId
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
