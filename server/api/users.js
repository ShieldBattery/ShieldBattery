import bcrypt from 'bcrypt'
import httpErrors from 'http-errors'
import thenify from 'thenify'
import users from '../models/users'
import initSession from '../session/init'
import setReturningCookie from '../session/set-returning-cookie'
import checkPermissions from '../permissions/check-permissions'
import { getTokenByEmail } from '../models/invites'
import { isValidUsername, isValidEmail, isValidPassword } from '../../shared/constants'
import { UNIQUE_VIOLATION } from '../db/pg-error-codes'

export default function(router) {
  router.post('/', createUser)
    .get('/:searchTerm', checkPermissions(['editPermissions']), find)
    .put('/:id', function* (next) {
      // TODO(tec27): update a user
      throw new httpErrors.ImATeapot()
    })
}

async function find(ctx, next) {
  const searchTerm = ctx.params.searchTerm

  try {
    const user = await users.find(searchTerm)
    ctx.body = user ? [ user ] : []
  } catch (err) {
    ctx.log.error({ err }, 'error finding user by name')
    throw err
  }
}

const bcryptHash = thenify(bcrypt.hash)
async function createUser(ctx, next) {
  const { username, password } = ctx.request.body
  const email = ctx.request.body.email.trim()
  const { token } = ctx.query

  if (!token) {
    throw new httpErrors.BadRequest('Token must be specified')
  }

  if (!isValidUsername(username) ||
      !isValidEmail(email) ||
      !isValidPassword(password)) {
    throw new httpErrors.BadRequest('Invalid parameters')
  }

  try {
    const tokenFromDb = await getTokenByEmail(email)
    if (token !== tokenFromDb) {
      throw new httpErrors.BadRequest('Invalid token')
    }
  } catch (err) {
    if (err.name === 'NonexistentEmail') {
      // Return same error as when token is invalid so we don't leak emails
      throw new httpErrors.BadRequest('Invalid token')
    }
    ctx.log.error({ err }, 'error getting email by token')
    throw err
  }

  let hashed
  try {
    hashed = await bcryptHash(password, 10)
  } catch (err) {
    ctx.log.error({ err }, 'error hashing password')
    throw err
  }

  let result
  try {
    const user = users.create(username, email, hashed)
    result = await user.save()
  } catch (err) {
    if (err.code && err.code === UNIQUE_VIOLATION) {
      throw new httpErrors.Conflict('A user with that name already exists')
    }
    ctx.log.error({ err }, 'error saving user')
    throw err
  }

  // regenerate the session to ensure that logged in sessions and anonymous sessions don't
  // share a session ID
  await ctx.regenerateSession()
  initSession(ctx, result.user, result.permissions)
  setReturningCookie(ctx)
  ctx.body = result
}
