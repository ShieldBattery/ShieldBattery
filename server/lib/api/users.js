import bcrypt from 'bcrypt'
import cuid from 'cuid'
import httpErrors from 'http-errors'
import thenify from 'thenify'
import createThrottle from '../throttle/create-throttle'
import throttleMiddleware from '../throttle/middleware'
import users from '../models/users'
import initSession from '../session/init'
import sendAccountVerificationEmail from '../verifications/send-account-verification-email'
import setReturningCookie from '../session/set-returning-cookie'
import { checkAnyPermission } from '../permissions/check-permissions'
import { usePasswordResetCode } from '../models/password-resets'
import {
  addEmailVerificationCode,
  getEmailVerificationsCount,
  useEmailVerificationCode,
} from '../models/email-verifications'
import { isValidUsername, isValidEmail, isValidPassword } from '../../../app/common/constants'
import { UNIQUE_VIOLATION } from '../db/pg-error-codes'
import transact from '../db/transaction'
import updateAllSessions from '../session/update-all-sessions'
import ensureLoggedIn from '../session/ensure-logged-in'

const accountCreationThrottle = createThrottle('accountcreation', {
  rate: 1,
  burst: 4,
  window: 60000,
})

const emailVerificationThrottle = createThrottle('emailverification', {
  rate: 10,
  burst: 20,
  window: 12 * 60 * 60 * 1000,
})

const sendVerificationThrottle = createThrottle('sendverification', {
  rate: 4,
  burst: 4,
  window: 12 * 60 * 60 * 1000,
})

export default function (router, { nydus }) {
  router
    .post(
      '/',
      throttleMiddleware(accountCreationThrottle, ctx => ctx.ip),
      createUser,
    )
    .get('/:searchTerm', checkAnyPermission('banUsers', 'editPermissions'), find)
    .put('/:id', function* (next) {
      // TODO(tec27): update a user
      throw new httpErrors.ImATeapot()
    })
    .post('/:username/password', resetPassword)
    .post(
      '/emailVerification',
      throttleMiddleware(emailVerificationThrottle, ctx => ctx.session.userId),
      ensureLoggedIn,
      (ctx, next) => verifyEmail(ctx, next, nydus),
    )
    .post(
      '/sendVerification',
      throttleMiddleware(sendVerificationThrottle, ctx => ctx.session.userId),
      ensureLoggedIn,
      sendVerificationEmail,
    )
}

async function find(ctx, next) {
  const searchTerm = ctx.params.searchTerm

  try {
    const user = await users.find(searchTerm)
    ctx.body = user ? [user] : []
  } catch (err) {
    throw err
  }
}

const bcryptHash = thenify(bcrypt.hash)
function hashPass(password) {
  return bcryptHash(password, 10)
}

async function createUser(ctx, next) {
  const { username, password } = ctx.request.body
  const email = ctx.request.body.email.trim()

  if (!isValidUsername(username) || !isValidEmail(email) || !isValidPassword(password)) {
    throw new httpErrors.BadRequest('Invalid parameters')
  }

  const hashed = await hashPass(password)

  let result
  try {
    const user = users.create(username, email, hashed, ctx.ip)
    result = await user.save()
  } catch (err) {
    if (err.code && err.code === UNIQUE_VIOLATION) {
      throw new httpErrors.Conflict('A user with that name already exists')
    }
    throw err
  }

  // regenerate the session to ensure that logged in sessions and anonymous sessions don't
  // share a session ID
  await ctx.regenerateSession()
  initSession(ctx, result.user, result.permissions)
  setReturningCookie(ctx)

  const code = cuid()
  await addEmailVerificationCode(result.user.id, email, code, ctx.ip)
  await sendAccountVerificationEmail(code, email)
  ctx.body = result
}

async function resetPassword(ctx, next) {
  const { username } = ctx.params
  const { code } = ctx.query
  const { password } = ctx.request.body

  if (!code || !isValidUsername(username) || !isValidPassword(password)) {
    throw new httpErrors.BadRequest('Invalid parameters')
  }

  await transact(async client => {
    try {
      await usePasswordResetCode(client, username, code)
    } catch (err) {
      throw new httpErrors.BadRequest('Password reset code is invalid')
    }

    const user = await users.find(username)
    user.password = await hashPass(password)
    await user.save()
    ctx.status = 204
  })
}

async function verifyEmail(ctx, next, nydus) {
  const { code } = ctx.query

  if (!code) {
    throw new httpErrors.BadRequest('Invalid parameters')
  }

  const user = await users.find(ctx.session.userId)
  if (!user) {
    throw new httpErrors.BadRequest('User not found')
  }

  const emailVerified = await useEmailVerificationCode(user.id, user.email, code)
  if (!emailVerified) {
    throw new httpErrors.BadRequest('Email verification code is invalid')
  }

  // Update all of the user's sessions to indicate that their email is now indeed verified.
  await updateAllSessions(ctx, { emailVerified: true })

  // Last thing to do is to notify all of the user's opened sockets that their email is now verified
  // NOTE(2Pac): With the way the things are currently set up on client (their socket is not
  // connected when they open the email verification page), the client making the request won't
  // actually get this event. Thankfully, that's easy to deal with on the client-side.
  nydus.publish('/userProfiles/' + ctx.session.userId, { action: 'emailVerified' })

  ctx.status = 204
}

async function sendVerificationEmail(ctx, next) {
  const user = await users.find(ctx.session.userId)
  if (!user) {
    throw new httpErrors.BadRequest('User not found')
  }

  const emailVerificationsCount = await getEmailVerificationsCount(user.id, user.email)
  if (emailVerificationsCount > 10) {
    throw new httpErrors.Conflict('Email is over verification limit')
  }

  const code = cuid()
  await addEmailVerificationCode(user.id, user.email, code, ctx.ip)
  await sendAccountVerificationEmail(code, user.email)
  ctx.status = 204
}
