var bcrypt = require('bcrypt')
  , thenify = require('thenify')
  , users = require('../models/users')
  , permissions = require('../models/permissions')
  , httpErrors = require('../http/errors')
  , initSession = require('../session/init')
  , setReturningCookie = require('../session/set-returning-cookie')

module.exports = function(router) {
  router
    .get('/', getCurrentSession)
    .delete('/', endSession)
    .post('/', startNewSession)
}

function* getCurrentSession(next) {
  if (!this.session.userId) throw new httpErrors.GoneError('Session expired')
  let userId = this.session.userId

  let user
  try {
    user = yield* users.find(userId)
  } catch (err) {
    this.log.error({ err: err }, 'error finding user')
    throw err
  }

  if (!user) {
    yield this.regenerateSession()
    throw new httpErrors.GoneError('Session expired')
  }

  this.body = { user: user, permissions: this.session.permissions }
}

let bcryptCompare = thenify(bcrypt.compare)
function* startNewSession(next) {
  if (!!this.session.userId) throw new httpErrors.ConflictError('Session already active')
  let { username, password, remember } = this.request.body
  remember = !!remember
  if (!username || !password) {
    throw new httpErrors.BadRequestError('Username and password required')
  }

  let user
  try {
    user = yield* users.find(username)
  } catch (err) {
    this.log.error({ err: err }, 'error finding user')
    throw err
  }
  if (!user) {
    throw new httpErrors.UnauthorizedError('Incorrect username or password')
  }

  let same
  try {
    same = yield bcryptCompare(password, user.password)
  } catch (err) {
    this.log.error({ err: err }, 'error comparing passwords')
    throw err
  }
  if (!same) {
    throw new httpErrors.UnauthorizedError('Incorrect username or password')
  }

  try {
    yield this.regenerateSession()
    let perms = yield* permissions.get(user.id)
    initSession(this, user, perms)
    setReturningCookie(this)

    this.body = { user: user, permissions: perms }
  } catch (err) {
    this.log.error({ err: err }, 'error regenerating session')
    throw err
  }
}

function* endSession(next) {
  if (!this.session.userId) throw new httpErrors.ConflictError('No session active')
  yield this.regenerateSession()
  this.status = 200
}
