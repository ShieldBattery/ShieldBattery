import Router, { RouterContext } from '@koa/router'
import httpErrors from 'http-errors'
import { container } from 'tsyringe'
import { banUser as dbBanUser, getBanHistory } from '../models/bans'
import { checkAllPermissions } from '../permissions/check-permissions'
import redis from '../redis'
import { findUserById } from '../users/user-model'
import { UserSocketsManager } from '../websockets/socket-groups'

export default function (router: Router) {
  router
    .get('/:userId', checkAllPermissions('banUsers'), getUserBanHistory)
    .post('/:userId', checkAllPermissions('banUsers'), banUser)
}

async function getUserBanHistory(ctx: RouterContext) {
  const userId = ctx.params.userId

  const banHistory = await getBanHistory(userId)
  ctx.body = banHistory.map(b => ({
    startTime: +b.startTime,
    endTime: +b.endTime,
    bannedBy: b.bannedBy,
    reason: b.reason,
  }))
}

async function banUser(ctx: RouterContext) {
  const userId = Number(ctx.params.userId)
  const { banLengthHours, reason } = ctx.request.body

  if (isNaN(userId)) {
    throw new httpErrors.BadRequest('User ID must be an integer')
  }
  if (!banLengthHours) {
    throw new httpErrors.BadRequest('Ban length must be specified')
  }

  if (userId === ctx.session!.userId) {
    throw new httpErrors.Conflict("Can't ban yourself")
  }

  const user = await findUserById(userId)
  if (!user) {
    throw new httpErrors.NotFound('User does not exist')
  }

  const userSockets = container.resolve(UserSocketsManager)

  const ban = await dbBanUser(userId, ctx.session!.userId, banLengthHours, reason)
  ctx.body = {
    startTime: Number(ban.startTime),
    endTime: Number(ban.endTime),
    bannedBy: ban.bannedBy,
    reason: ban.reason,
  }
  // Clear all existing sessions for this user
  const userSessionsKey = 'user_sessions:' + userId
  const userSessionIds = await redis.smembers(userSessionsKey)

  // We could also use ioredis#pipeline here, but I think in practice the number of sessions per
  // user ID will be fairly low
  const deletions = userSessionIds.map(id => redis.del(id))
  await Promise.all(deletions)
  const keyDeletion = redis.del(userSessionsKey)

  const sockets = userSockets.getById(userId)
  if (sockets) {
    sockets.closeAll()
  }

  await keyDeletion
}
