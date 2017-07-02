import httpErrors from 'http-errors'
import cuid from 'cuid'
import createThrottle from '../throttle/create-throttle'
import throttleMiddleware from '../throttle/middleware'
import { findAllUsernamesWithEmail, findUser } from '../models/users'
import { addPasswordResetCode } from '../models/password-resets'
import { isValidUsername, isValidEmail } from '../../../app/common/constants'
import sendMail from '../mail/mailer'

const forgotUserPassThrottle = createThrottle('forgotuserpass', {
  rate: 30,
  burst: 50,
  window: 12 * 60 * 60 * 1000,
})

// Extra throttles on success to ensure we don't spam people with emails
const forgotUserSuccessThrottle = createThrottle('forgotusersuccess', {
  rate: 2,
  burst: 2,
  window: 12 * 60 * 60 * 1000,
})
const forgotPasswordSuccessThrottle = createThrottle('forgotpasssuccess', {
  rate: 2,
  burst: 2,
  window: 12 * 60 * 60 * 1000,
})

export default function(router) {
  router
    .post('/user', throttleMiddleware(forgotUserPassThrottle, ctx => ctx.ip), recoverUsername)
    .post('/password', throttleMiddleware(forgotUserPassThrottle, ctx => ctx.ip), resetPassword)
}

async function recoverUsername(ctx, next) {
  let { email } = ctx.request.body
  if (!email) {
    throw new httpErrors.BadRequest('email must be specified')
  }

  email = email.trim()
  if (!isValidEmail(email)) {
    throw new httpErrors.BadRequest('invalid parameters')
  }

  const users = await findAllUsernamesWithEmail(email)
  ctx.status = 204

  if (!users.length) {
    return
  }

  const isLimited = await forgotUserSuccessThrottle.rateLimit(email)
  if (isLimited) {
    ctx.log.warn('email is over username recovery limit')
    return
  }

  await sendMail({
    to: email,
    subject: 'ShieldBattery Username Recovery',
    templateName: 'username-recovery',
    templateData: {
      usernames: users.map(username => ({ username })),
    },
  })
}

async function resetPassword(ctx, next) {
  const { email, username } = ctx.request.body
  if (!username || !email) {
    throw new httpErrors.BadRequest('invalid parameters')
  }

  const trimmedEmail = email.trim()
  if (!isValidUsername(username) || !isValidEmail(trimmedEmail)) {
    throw new httpErrors.BadRequest('invalid parameters')
  }

  const user = await findUser(username)
  ctx.status = 204

  if (!user || user.email !== trimmedEmail) {
    return
  }

  const isLimited = await forgotPasswordSuccessThrottle.rateLimit(username.toLowerCase())
  if (isLimited) {
    ctx.log.warn('user is over password recovery limit')
    return
  }

  const code = cuid()
  await addPasswordResetCode(user.id, code, ctx.ip)

  await sendMail({
    to: user.email,
    subject: 'ShieldBattery Password Reset',
    templateName: 'password-reset',
    templateData: {
      username: user.name,
      token: code,
    },
  })
}
