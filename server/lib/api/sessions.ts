import Router, { RouterContext } from '@koa/router'
import httpErrors from 'http-errors'
import { container } from 'tsyringe'
import { MatchmakingType } from '../../../common/matchmaking'
import { ClientSessionInfo } from '../../../common/users/session'
import { SelfUser } from '../../../common/users/user-info'
import { isUserBanned } from '../models/bans'
import { getPermissions } from '../models/permissions'
import { Redis } from '../redis'
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
    ctx.log.error({ err }, 'error finding user')
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
    let user: SelfUser | undefined
    try {
      user = await findSelfById(ctx.session.userId)
    } catch (err) {
      ctx.log.error({ err }, 'error finding user')
      throw err
    }
    const { permissions, lastQueuedMatchmakingType } = ctx.session
    const result: ClientSessionInfo = {
      user: user!,
      permissions,
      lastQueuedMatchmakingType,
    }
    ctx.body = result

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
    const perms = (await getPermissions(user.id))!
    await maybeMigrateSignupIp(user.id, ctx.ip)

    const sessionInfo: ClientSessionInfo = {
      user,
      permissions: perms,
      lastQueuedMatchmakingType: MatchmakingType.Match1v1,
    }

    initSession(ctx, sessionInfo)
    if (!remember) {
      // Make the cookie a session-expiring cookie
      ctx.session!.cookie.maxAge = undefined
      ctx.session!.cookie.expires = undefined
    }

    ctx.body = sessionInfo
  } catch (err) {
    ctx.log.error({ err }, 'error regenerating session')
    throw err
  }
}

async function endSession(ctx: RouterContext) {
  if (!ctx.session?.userId) {
    throw new httpErrors.Conflict('No session active')
  }

  const redis = container.resolve(Redis)
  await redis.srem('user_sessions:' + ctx.session.userId, ctx.sessionId!)
  await ctx.regenerateSession()
  ctx.status = 204
}
