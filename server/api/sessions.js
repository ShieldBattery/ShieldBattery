import bcrypt from 'bcrypt'
import thenify from 'thenify'
import users from '../models/users'
import permissions from '../models/permissions'
import httpErrors from '../http/errors'
import initSession from '../session/init'
import setReturningCookie from '../session/set-returning-cookie'

export default function(router) {
  router
    .get('/', getCurrentSession)
    .delete('/', endSession)
    .post('/', startNewSession)
}

function* getCurrentSession(next) {
  if (!this.session.userId) throw new httpErrors.GoneError('Session expired')
  const userId = this.session.userId

  let user
  try {
    user = yield* users.find(userId)
  } catch (err) {
    this.log.error({ err }, 'error finding user')
    throw err
  }

  if (!user) {
    yield this.regenerateSession()
    throw new httpErrors.GoneError('Session expired')
  }

  this.body = { user, permissions: this.session.permissions }
}

const bcryptCompare = thenify(bcrypt.compare)
function* startNewSession(next) {
  if (this.session.userId) throw new httpErrors.ConflictError('Session already active')
  const { username, password } = this.request.body
  // TODO(tec27): Deal with 'remember' param properly
  if (!username || !password) {
    throw new httpErrors.BadRequestError('Username and password required')
  }

  let user
  try {
    user = yield* users.find(username)
  } catch (err) {
    this.log.error({ err }, 'error finding user')
    throw err
  }
  if (!user) {
    throw new httpErrors.UnauthorizedError('Incorrect username or password')
  }

  let same
  try {
    same = yield bcryptCompare(password, user.password)
  } catch (err) {
    this.log.error({ err }, 'error comparing passwords')
    throw err
  }
  if (!same) {
    throw new httpErrors.UnauthorizedError('Incorrect username or password')
  }

  try {
    yield this.regenerateSession()
    const perms = yield* permissions.get(user.id)
    initSession(this, user, perms)
    setReturningCookie(this)

    this.body = { user, permissions: perms }
  } catch (err) {
    this.log.error({ err }, 'error regenerating session')
    throw err
  }
}

function* endSession(next) {
  if (!this.session.userId) throw new httpErrors.ConflictError('No session active')
  yield this.regenerateSession()
  this.status = 204
}
