import httpErrors from 'http-errors'
import cuid from 'cuid'
import invites from '../models/invites'
import checkPermissions from '../permissions/check-permissions'
import { isValidEmail } from '../../shared/constants'
import transact from '../db/transaction'
import sendMail from '../mail/mailer'

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
    // Swallow dupe email error to prevent leaking already signed up emails
    if (err.name !== 'DuplicateEmail') {
      throw err
    }
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
}

function* acceptInvite(next) {
  if (!isValidEmail(this.params.email)) {
    throw new httpErrors.BadRequest('Invalid email')
  }
  if (!this.request.body.isAccepted) {
    throw new httpErrors.NotImplemented('Not implemented')
  }

  const token = cuid()

  yield transact(async client => {
    const invite = await invites.accept(client, this.params.email, token)
    await sendMail({
      to: invite.email,
      subject: 'Welcome to ShieldBattery',
      templateName: 'invite',
      templateData: {
        email: invite.email,
        token: invite.token,
      }
    })

    this.body = invite
  })
}
