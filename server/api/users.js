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

function* find(next) {
  const searchTerm = this.params.searchTerm

  try {
    const user = yield users.find(searchTerm)
    this.body = user ? [ user ] : []
  } catch (err) {
    this.log.error({ err }, 'error finding user by name')
    throw err
  }
}

const bcryptHash = thenify(bcrypt.hash)
function* createUser(next) {
  const { username, password } = this.request.body
  const email = this.request.body.email.trim()
  const { token } = this.query

  if (!token) {
    throw new httpErrors.BadRequest('Token must be specified')
  }

  if (!isValidUsername(username) ||
      !isValidEmail(email) ||
      !isValidPassword(password)) {
    throw new httpErrors.BadRequest('Invalid parameters')
  }

  try {
    const tokenFromDb = yield* getTokenByEmail(email)
    if (token !== tokenFromDb) {
      throw new httpErrors.BadRequest('Invalid token')
    }
  } catch (err) {
    if (err.name === 'NonexistentEmail') {
      // Return same error as when token is invalid so we don't leak emails
      throw new httpErrors.BadRequest('Invalid token')
    }
    this.log.error({ err }, 'error getting email by token')
    throw err
  }

  let hashed
  try {
    hashed = yield bcryptHash(password, 10)
  } catch (err) {
    this.log.error({ err }, 'error hashing password')
    throw err
  }

  let result
  try {
    const user = users.create(username, email, hashed)
    result = yield* user.save()
  } catch (err) {
    if (err.code && err.code === UNIQUE_VIOLATION) {
      throw new httpErrors.Conflict('A user with that name already exists')
    }
    this.log.error({ err }, 'error saving user')
    throw err
  }

  // regenerate the session to ensure that logged in sessions and anonymous sessions don't
  // share a session ID
  yield this.regenerateSession()
  initSession(this, result.user, result.permissions)
  setReturningCookie(this)
  this.body = result
}
