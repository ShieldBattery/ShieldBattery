import co from 'co'
import bcrypt from 'bcrypt'
import thenify from 'thenify'
import httpErrors from 'http-errors'
import Redis from 'ioredis'
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
  const { username, password } = ctx.request.body
  // TODO(tec27): Deal with 'remember' param properly
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

  try {
    await co(ctx.regenerateSession())
    const perms = await permissions.get(user.id)
    await users.maybeUpdateIp(user.id, ctx.ip)
    initSession(ctx, user, perms)
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

  const redis = new Redis()
  await redis.srem('user_sessions:' + ctx.session.userId, ctx.sessionId)
  await co(ctx.regenerateSession())
  ctx.status = 204
}
