var constants = require('../../shared/constants')
  , bcrypt = require('bcrypt')
  , thenify = require('thenify')
  , users = require('../models/users')
  , httpErrors = require('../http/errors')
  , initSession = require('../session/init')
  , setReturningCookie = require('../session/set-returning-cookie')
  , checkPermissions = require('../permissions/check-permissions')

module.exports = function(router) {
  router.post('/', createUser)
    .get('/:searchTerm', checkPermissions(['editPermissions']), find)
    .put('/:id', function(req, res, next) {
      // TODO(tec27): update a user
      next(new httpErrors.ImATeapotError())
    })
}

function* find(next) {
  let searchTerm = this.params.searchTerm

  try {
    let user = yield* users.find(searchTerm)
    this.body = !!user ? [ user ] : []
  } catch (err) {
    this.log.error({ err: err }, 'error finding user by name')
    throw err
  }
}

var bcryptHash = thenify(bcrypt.hash)
function* createUser(next) {
  let { username, email, password } = this.request.body

  if (!constants.isValidUsername(username) ||
      !constants.isValidEmail(email) ||
      !constants.isValidPassword(password)) {
    throw new httpErrors.BadRequestError('Invalid parameters')
  }

  let hashed
  try {
    hashed = yield bcryptHash(password, 10)
  } catch (err) {
    this.log.error({ err: err }, 'error hashing password')
    throw err
  }

  let result
  try {
    let user = users.create(username, email, hashed)
    result = yield* user.save()
  } catch (err) {
    if (err.code && err.code == 23505) {
      // TODO(tec27): this is a nasty check, we should find a better way of dealing with this
      throw new httpErrors.ConflictError('A user with that name already exists')
    }
    this.log.error({ err: err }, 'error saving user')
    throw err
  }

  // regenerate the session to ensure that logged in sessions and anonymous sessions don't
  // share a session ID
  yield this.regenerateSession()
  initSession(this, result.user, result.permissions)
  setReturningCookie(this)
  this.body = result
}
