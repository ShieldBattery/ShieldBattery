import Router, { RouterContext } from '@koa/router'
import httpErrors from 'http-errors'
import { MatchmakingType } from '../../../common/matchmaking'
import { ClientSessionInfo } from '../../../common/users/session'
import { SelfUser } from '../../../common/users/user-info'
import { isUserBanned } from '../models/bans'
import { getPermissions } from '../models/permissions'
import redis from '../redis'
import initSession from '../session/init'
import createThrottle from '../throttle/create-throttle'
import throttleMiddleware from '../throttle/middleware'
import { attemptLogin, findSelfById, maybeMigrateSignupIp } from '../users/user-model'

// TODO(tec27): Think about maybe a different mechanism for this. I could see this causing problems
// when lots of people need to create sessions at once from the same place (e.g. LAN events)
const loginThrottle = createThrottle('login', {
  rate: 4,
  burst: 20,
  window: 60000,
})

export default function (router: Router) {
  router
    .get('/', getCurrentSession)
    .delete('/', endSession)
    .post(
      '/',
      throttleMiddleware(loginThrottle, ctx => ctx.ip),
      startNewSession,
    )
}

async function getCurrentSession(ctx: RouterContext) {
  if (!ctx.session?.userId) throw new httpErrors.Gone('Session expired')
  const userId = ctx.session.userId

  let user: SelfUser | undefined
  try {
    user = await findSelfById(userId)
  } catch (err) {
    ctx.log.error({ err, req: ctx.req }, 'error finding user')
    throw err
  }

  if (!user) {
    await ctx.regenerateSession()
    throw new httpErrors.Gone('Session expired')
  }

  const result: ClientSessionInfo = {
    user,
    permissions: ctx.session.permissions,
    lastQueuedMatchmakingType: ctx.session.lastQueuedMatchmakingType,
  }
  ctx.body = result
}

async function startNewSession(ctx: RouterContext) {
  if (ctx.session?.userId) {
    const { userId, userName, permissions, emailVerified, lastQueuedMatchmakingType } = ctx.session
    ctx.body = {
      user: { id: userId, name: userName, emailVerified },
      permissions,
      lastQueuedMatchmakingType,
    }

    return
  }
  const { username, password, remember } = ctx.request.body
  if (!username || !password) {
    throw new httpErrors.BadRequest('Username and password required')
  }

  const user = await attemptLogin(username, password)
  if (!user) {
    throw new httpErrors.Unauthorized('Incorrect username or password')
  }

  const isBanned = await isUserBanned(user.id)
  if (isBanned) {
    throw new httpErrors.Unauthorized('This account has been banned')
  }

  try {
    await ctx.regenerateSession()
    const perms = await getPermissions(user.id)
    await maybeMigrateSignupIp(user.id, ctx.ip)
    initSession(ctx, user, perms)
    if (!remember) {
      // Make the cookie a session-expiring cookie
      ctx.session!.cookie.maxAge = undefined
      ctx.session!.cookie.expires = undefined
    }

    const result: ClientSessionInfo = {
      user,
      permissions: perms,
      lastQueuedMatchmakingType: MatchmakingType.Match1v1,
    }
    ctx.body = result
  } catch (err) {
    ctx.log.error({ err, req: ctx.req }, 'error regenerating session')
    throw err
  }
}

async function endSession(ctx: RouterContext) {
  if (!ctx.session?.userId) {
    throw new httpErrors.Conflict('No session active')
  }

  await redis.srem('user_sessions:' + ctx.session.userId, ctx.sessionId!)
  await ctx.regenerateSession()
  ctx.status = 204
}
