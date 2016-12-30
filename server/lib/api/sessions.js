import co from 'co'
import bcrypt from 'bcrypt'
import thenify from 'thenify'
import httpErrors from 'http-errors'
import redis from '../redis'
import { isUserBanned } from '../models/bans'
import users from '../models/users'
import permissions from '../models/permissions'
import initSession from '../session/init'
import setReturningCookie from '../session/set-returning-cookie'

export default function(router) {
  router
    .get('/', getCurrentSession)
    .delete('/', endSession)
    .post('/', startNewSession)
}

async function getCurrentSession(ctx, next) {
  if (!ctx.session.userId) throw new httpErrors.Gone('Session expired')
  const userId = ctx.session.userId

  let user
  try {
    user = await users.find(userId)
  } catch (err) {
    ctx.log.error({ err }, 'error finding user')
    throw err
  }

  if (!user) {
    await co(ctx.regenerateSession())
    throw new httpErrors.Gone('Session expired')
  }

  ctx.body = { user, permissions: ctx.session.permissions }
}

const bcryptCompare = thenify(bcrypt.compare)
async function startNewSession(ctx, next) {
  if (ctx.session.userId) throw new httpErrors.Conflict('Session already active')
  const { username, password, remember } = ctx.request.body
  if (!username || !password) {
    throw new httpErrors.BadRequest('Username and password required')
  }

  let user
  try {
    user = await users.find(username)
  } catch (err) {
    ctx.log.error({ err }, 'error finding user')
    throw err
  }
  if (!user) {
    throw new httpErrors.Unauthorized('Incorrect username or password')
  }

  let same
  try {
    same = await bcryptCompare(password, user.password)
  } catch (err) {
    ctx.log.error({ err }, 'error comparing passwords')
    throw err
  }
  if (!same) {
    throw new httpErrors.Unauthorized('Incorrect username or password')
  }

  let isBanned = false
  try {
    isBanned = await isUserBanned(user.id)
  } catch (err) {
    ctx.log.error({ err }, 'error checking if user is banned')
    throw err
  }
  if (isBanned) {
    throw new httpErrors.Unauthorized('This account has been banned')
  }

  try {
    await co(ctx.regenerateSession())
    const perms = await permissions.get(user.id)
    await users.maybeUpdateIp(user.id, ctx.ip)
    initSession(ctx, user, perms)
    if (!remember) {
      // Make the cookie a session-expiring cookie
      ctx.session.cookie.maxAge = undefined
      ctx.session.cookie.expires = undefined
    }
    setReturningCookie(ctx)

    ctx.body = { user, permissions: perms }
  } catch (err) {
    ctx.log.error({ err }, 'error regenerating session')
    throw err
  }
}

async function endSession(ctx, next) {
  if (!ctx.session.userId) {
    throw new httpErrors.Conflict('No session active')
  }

  await redis.srem('user_sessions:' + ctx.session.userId, ctx.sessionId)
  await co(ctx.regenerateSession())
  ctx.status = 204
}
