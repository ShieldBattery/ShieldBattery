var constants = require('../../shared/constants')
  , invites = require('../models/invites')
  , httpErrors = require('../http/errors')
  , checkPermissions = require('../permissions/check-permissions')
  , cuid = require('cuid')

module.exports = function(router) {
  router
    .post('/', createInvite)
    .get('/', checkPermissions(['acceptInvites']), listInvites)
    .put('/:email', checkPermissions(['acceptInvites']), acceptInvite)
}

function* createInvite(next) {
  var invite =  { email: this.body.email
                , teamliquidName: this.body.teamliquidName
                , os: this.body.os
                , browser: this.body.browser
                , graphics: this.body.graphics
                , canHost: this.body.canHost
                }
  if (!invite.email || !constants.isValidEmail(invite.email)) {
    throw new httpErrors.BadRequestError('Invalid email')
  }

  try {
    yield* invites.create(invite)
  } catch (err) {
    this.log.error({ err: err }, 'error creating invite')
    throw err
  }

  this.status = 201
}

function* listInvites(next) {
  try {
    if (this.query.accepted) {
      if (this.query.accepted == 'true') {
        this.body = yield* invites.getAccepted()
      } else {
        this.body = yield* invites.getUnaccepted()
      }
    } else {
      this.body = yield* invites.getAll()
    }
  } catch (err) {
    this.log.error({ err: err }, 'error getting invites')
    throw err
  }

}

function* acceptInvite(next) {
  if (!constants.isValidEmail(this.params.email)) {
    throw new httpErrors.BadRequestError('Invalid email')
  }
  if (!this.body.isAccepted) {
    throw new httpErrors.NotImplementedError('Not implemented')
  }

  let token = cuid()
  try {
    this.body = yield* invites.accept(this.params.email, token)
  } catch (err) {
    this.log.error({ err: err }, 'error accepting invite')
    throw err
  }
}
