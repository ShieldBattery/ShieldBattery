import httpErrors from 'http-errors'
import cuid from 'cuid'
import invites from '../models/invites'
import checkPermissions from '../permissions/check-permissions'
import { isValidEmail } from '../../shared/constants'

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
  if (!invite.email || !isValidEmail(invite.email)) {
    throw new httpErrors.BadRequest('Invalid email')
  }

  try {
    yield* invites.create(invite)
  } catch (err) {
    if (err.name === 'DuplicateEmail') {
      // Swallow the error to prevent leaking already signed up emails
      this.status = 201
      return
    }
    this.log.error({ err }, 'error creating invite')
    throw err
  }

  this.status = 201
}

function* listInvites(next) {
  let { limit, page: pageNumber } = this.query

  limit = parseInt(limit, 10)
  if (!limit || isNaN(limit) || limit < 0 || limit > 100) {
    limit = 25
  }

  pageNumber = parseInt(pageNumber, 10)
  if (!pageNumber || isNaN(pageNumber) || pageNumber < 0) {
    pageNumber = 0
  }

  try {
    if (this.query.accepted) {
      if (this.query.accepted === 'true') {
        const { total, invites: invs } = yield* invites.getAccepted(limit, pageNumber)
        this.body = {
          total,
          invites: invs,
          limit,
          pageNumber
        }
      } else {
        const { total, invites: invs } = yield* invites.getUnaccepted(limit, pageNumber)
        this.body = {
          total,
          invites: invs,
          limit,
          pageNumber
        }
      }
    } else {
      const { total, invites: invs } = yield* invites.getAll(limit, pageNumber)
      this.body = {
        total,
        invites: invs,
        limit,
        pageNumber
      }
    }
  } catch (err) {
    this.log.error({ err }, 'error getting invites')
    throw err
  }
}

function* acceptInvite(next) {
  if (!isValidEmail(this.params.email)) {
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
