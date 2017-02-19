import httpErrors from 'http-errors'
import redis from '../redis'
import { banUser as dbBanUser } from '../models/bans'
import users from '../models/users'
import { checkAllPermissions } from '../permissions/check-permissions'

export default function(router, userSockets) {
  router
    .get('/:userId', checkAllPermissions('banUsers'), getUserBanHistory)
    .post('/:userId', checkAllPermissions('banUsers'),
        (ctx, next) => banUser(ctx, next, userSockets))
}

async function getUserBanHistory(ctx, next) {
  throw new httpErrors.NotImplemented()
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

  await dbBanUser(userId, ctx.session.userId, banLengthHours, reason)
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
