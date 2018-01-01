import bcrypt from 'bcrypt'
import httpErrors from 'http-errors'
import thenify from 'thenify'
import createThrottle from '../throttle/create-throttle'
import throttleMiddleware from '../throttle/middleware'
import users from '../models/users'
import initSession from '../session/init'
import setReturningCookie from '../session/set-returning-cookie'
import { checkAnyPermission } from '../permissions/check-permissions'
import { usePasswordResetCode } from '../models/password-resets'
import { isValidUsername, isValidEmail, isValidPassword } from '../../../app/common/constants'
import { UNIQUE_VIOLATION } from '../db/pg-error-codes'
import transact from '../db/transaction'

const accountCreationThrottle = createThrottle('accountcreation', {
  rate: 1,
  burst: 4,
  window: 60000,
})

export default function(router) {
  router
    .post('/', throttleMiddleware(accountCreationThrottle, ctx => ctx.ip), createUser)
    .get('/:searchTerm', checkAnyPermission('banUsers', 'editPermissions'), find)
    .put('/:id', function*(next) {
      // TODO(tec27): update a user
      throw new httpErrors.ImATeapot()
    })
    .post('/:username/password', resetPassword)
}

async function find(ctx, next) {
  const searchTerm = ctx.params.searchTerm

  try {
    const user = await users.find(searchTerm)
    ctx.body = user ? [user] : []
  } catch (err) {
    throw err
  }
}

const bcryptHash = thenify(bcrypt.hash)
function hashPass(password) {
  return bcryptHash(password, 10)
}

async function createUser(ctx, next) {
  const { username, password } = ctx.request.body
  const email = ctx.request.body.email.trim()

  if (!isValidUsername(username) || !isValidEmail(email) || !isValidPassword(password)) {
    throw new httpErrors.BadRequest('Invalid parameters')
  }

  const hashed = await hashPass(password)

  let result
  try {
    const user = users.create(username, email, hashed, ctx.ip)
    result = await user.save()
  } catch (err) {
    if (err.code && err.code === UNIQUE_VIOLATION) {
      throw new httpErrors.Conflict('A user with that name already exists')
    }
    throw err
  }

  // regenerate the session to ensure that logged in sessions and anonymous sessions don't
  // share a session ID
  await ctx.regenerateSession()
  initSession(ctx, result.user, result.permissions)
  setReturningCookie(ctx)
  ctx.body = result
}

async function resetPassword(ctx, next) {
  const { username } = ctx.params
  const { code } = ctx.query
  const { password } = ctx.request.body

  if (!code || !isValidUsername(username) || !isValidPassword(password)) {
    throw new httpErrors.BadRequest('Invalid parameters')
  }

  await transact(async client => {
    try {
      await usePasswordResetCode(client, username, code)
    } catch (err) {
      throw new httpErrors.BadRequest('Password reset code is invalid')
    }

    const user = await users.find(username)
    user.password = await hashPass(password)
    await user.save()
    ctx.status = 204
  })
}
