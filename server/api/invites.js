import constants from '../../shared/constants'
import invites from '../models/invites'
import checkPermissions from '../permissions/check-permissions'
import httpErrors from 'http-errors'
import cuid from 'cuid'

export default function(router) {
  router
    .post('/', createInvite)
    .get('/', checkPermissions(['acceptInvites']), listInvites)
    .put('/:email', checkPermissions(['acceptInvites']), acceptInvite)
}

function* createInvite(next) {
  const b = this.request.body
  const invite = {
    email: b.email,
    teamliquidName: b.teamliquidName,
    os: b.os,
    browser: b.browser,
    graphics: b.graphics,
    canHost: b.canHost,
  }
  if (!invite.email || !constants.isValidEmail(invite.email)) {
    throw new httpErrors.BadRequest('Invalid email')
  }

  try {
    yield* invites.create(invite)
  } catch (err) {
    this.log.error({ err }, 'error creating invite')
    throw err
  }

  this.status = 201
}

function* listInvites(next) {
  try {
    if (this.query.accepted) {
      if (this.query.accepted === 'true') {
        this.body = yield* invites.getAccepted()
      } else {
        this.body = yield* invites.getUnaccepted()
      }
    } else {
      this.body = yield* invites.getAll()
    }
  } catch (err) {
    this.log.error({ err }, 'error getting invites')
    throw err
  }
}

function* acceptInvite(next) {
  if (!constants.isValidEmail(this.params.email)) {
    throw new httpErrors.BadRequest('Invalid email')
  }
  if (!this.request.body.isAccepted) {
    throw new httpErrors.NotImplemented('Not implemented')
  }

  const token = cuid()
  try {
    this.body = yield* invites.accept(this.params.email, token)
  } catch (err) {
    this.log.error({ err }, 'error accepting invite')
    throw err
  }
}
