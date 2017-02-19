import httpErrors from 'http-errors'
import cuid from 'cuid'
import createThrottle from '../throttle/create-throttle'
import invites from '../models/invites'
import { checkAllPermissions } from '../permissions/check-permissions'
import { isValidEmail } from '../../../app/common/constants'
import transact from '../db/transaction'
import sendMail from '../mail/mailer'
import config from '../../config.js'

// The expectation is that you should *really* not be signing up for beta that often, so this rate
// is pretty low
const throttle = createThrottle('invitesignup', {
  rate: 1,
  burst: 4,
  window: 60000,
})
async function rateLimit(ctx, next) {
  const isLimited = await throttle.rateLimit(ctx.ip)
  if (isLimited) {
    throw new httpErrors.TooManyRequests()
  } else {
    await next()
  }
}

export default function(router) {
  router
    .post('/', rateLimit, createInvite)
    .get('/', checkAllPermissions('acceptInvites'), listInvites)
    .put('/:email', checkAllPermissions('acceptInvites'), acceptInvite)
}

async function createInvite(ctx, next) {
  const b = ctx.request.body
  const invite = {
    email: b.email.trim(),
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
    await invites.create(invite)
  } catch (err) {
    // Swallow dupe email error to prevent leaking already signed up emails
    if (err.name !== 'DuplicateEmail') {
      throw err
    }
  }

  ctx.status = 201
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
        pageNumber
      }
    } else {
      const { total, invites: invs } = await invites.getUnaccepted(limit, pageNumber)
      ctx.body = {
        total,
        invites: invs,
        limit,
        pageNumber
      }
    }
  } else {
    const { total, invites: invs } = await invites.getAll(limit, pageNumber)
    ctx.body = {
      total,
      invites: invs,
      limit,
      pageNumber
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
        feedbackUrl: config.feedbackUrl,
        installerUrl: `${config.canonicalHost}/installer.msi`,
      }
    })

    ctx.body = invite
  })
}
