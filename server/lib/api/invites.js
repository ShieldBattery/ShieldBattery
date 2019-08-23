import httpErrors from 'http-errors'
import cuid from 'cuid'
import invites from '../models/invites'
import { checkAllPermissions } from '../permissions/check-permissions'
import { isValidEmail } from '../../../app/common/constants'
import transact from '../db/transaction'
import sendMail from '../mail/mailer'

export default function(router) {
  router
    .get('/', checkAllPermissions('acceptInvites'), listInvites)
    .put('/:email', checkAllPermissions('acceptInvites'), acceptInvite)
}

async function listInvites(ctx, next) {
  let { limit, page: pageNumber } = ctx.query

  limit = parseInt(limit, 10)
  if (!limit || isNaN(limit) || limit < 0 || limit > 100) {
    limit = 25
  }

  pageNumber = parseInt(pageNumber, 10)
  if (!pageNumber || isNaN(pageNumber) || pageNumber < 0) {
    pageNumber = 0
  }

  if (ctx.query.accepted) {
    if (ctx.query.accepted === 'true') {
      const { total, invites: invs } = await invites.getAccepted(limit, pageNumber)
      ctx.body = {
        total,
        invites: invs,
        limit,
        pageNumber,
      }
    } else {
      const { total, invites: invs } = await invites.getUnaccepted(limit, pageNumber)
      ctx.body = {
        total,
        invites: invs,
        limit,
        pageNumber,
      }
    }
  } else {
    const { total, invites: invs } = await invites.getAll(limit, pageNumber)
    ctx.body = {
      total,
      invites: invs,
      limit,
      pageNumber,
    }
  }
}

async function acceptInvite(ctx, next) {
  if (!isValidEmail(ctx.params.email)) {
    throw new httpErrors.BadRequest('Invalid email')
  }
  if (!ctx.request.body.isAccepted) {
    throw new httpErrors.NotImplemented('Not implemented')
  }

  const token = cuid()

  await transact(async client => {
    const invite = await invites.accept(client, ctx.params.email, token)
    await sendMail({
      to: invite.email,
      subject: 'Welcome to ShieldBattery',
      templateName: 'invite',
      templateData: {
        email: invite.email,
        escapedEmail: encodeURIComponent(invite.email),
        token: invite.token,
        feedbackUrl: process.env.SB_FEEDBACK_URL,
        installerUrl: `${process.env.SB_CANONICAL_HOST}/installer.msi`,
      },
    })

    ctx.body = invite
  })
}
