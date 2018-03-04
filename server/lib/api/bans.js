import httpErrors from 'http-errors'
import redis from '../redis'
import { getBanHistory, banUser as dbBanUser } from '../models/bans'
import users from '../models/users'
import { checkAllPermissions } from '../permissions/check-permissions'

export default function(router, { userSockets }) {
  router
    .get('/:userId', checkAllPermissions('banUsers'), getUserBanHistory)
    .post('/:userId', checkAllPermissions('banUsers'), (ctx, next) =>
      banUser(ctx, next, userSockets),
    )
}

async function getUserBanHistory(ctx, next) {
  const userId = ctx.params.userId

  const banHistory = await getBanHistory(userId)
  ctx.body = banHistory.map(b => ({
    startTime: +b.startTime,
    endTime: +b.endTime,
    bannedBy: b.bannedBy,
    reason: b.reason,
  }))
}

async function banUser(ctx, next, userSockets) {
  const userId = +ctx.params.userId
  const { banLengthHours, reason } = ctx.request.body

  if (isNaN(userId)) {
    throw new httpErrors.BadRequest('User ID must be an integer')
  }
  if (!banLengthHours) {
    throw new httpErrors.BadRequest('Ban length must be specified')
  }

  const user = await users.find(userId)
  if (user === null) {
    throw new httpErrors.NotFound('User does not exist')
  }
  if (userId === ctx.session.userId) {
    throw new httpErrors.Conflict("Can't ban yourself")
  }

  try {
    const ban = await dbBanUser(userId, ctx.session.userId, banLengthHours, reason)
    ctx.body = {
      startTime: +ban.startTime,
      endTime: +ban.endTime,
      bannedBy: ban.bannedBy,
      reason: ban.reason,
    }
  } catch (err) {
    ctx.log.error({ err }, 'error banning the user')
    throw err
  }
  // Clear all existing sessions for this user
  const userSessionsKey = 'user_sessions:' + userId
  const userSessionIds = await redis.smembers(userSessionsKey)

  // We could also use ioredis#pipeline here, but I think in practice the number of sessions per
  // user ID will be fairly low
  const deletions = userSessionIds.map(id => redis.del(id))
  await Promise.all(deletions)
  const keyDeletion = redis.del(userSessionsKey)

  const sockets = userSockets.getByName(user.name)
  if (sockets) {
    sockets.closeAll()
  }

  await keyDeletion
}
