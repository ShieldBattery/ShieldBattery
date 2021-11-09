import { RouterContext } from '@koa/router'
import bcrypt from 'bcrypt'
import cuid from 'cuid'
import httpErrors from 'http-errors'
import Joi from 'joi'
import { NydusServer } from 'nydus'
import { assertUnreachable } from '../../../common/assert-unreachable'
import { isValidEmail, isValidPassword, isValidUsername } from '../../../common/constants'
import { toGameRecordJson } from '../../../common/games/games'
import { LadderPlayer } from '../../../common/ladder'
import { toMapInfoJson } from '../../../common/maps'
import { ALL_MATCHMAKING_TYPES, MatchmakingType } from '../../../common/matchmaking'
import { ALL_POLICY_TYPES, SbPolicyType } from '../../../common/policies/policy-type'
import { SbPermissions } from '../../../common/users/permissions'
import { ClientSessionInfo } from '../../../common/users/session'
import {
  AcceptPoliciesBody,
  AcceptPoliciesPayload,
  GetUserProfilePayload,
  SbUser,
  SbUserId,
  SelfUser,
} from '../../../common/users/user-info'
import { UNIQUE_VIOLATION } from '../db/pg-error-codes'
import transact from '../db/transaction'
import { HttpErrorWithPayload } from '../errors/error-with-payload'
import { getRecentGamesForUser } from '../games/game-models'
import { httpApi } from '../http/http-api'
import { httpBefore, httpGet, httpPatch, httpPost } from '../http/route-decorators'
import sendMail from '../mail/mailer'
import { getMapInfo } from '../maps/map-models'
import { getRankForUser } from '../matchmaking/models'
import {
  addEmailVerificationCode,
  consumeEmailVerificationCode,
  getEmailVerificationsCount,
} from '../models/email-verifications'
import { usePasswordResetCode } from '../models/password-resets'
import { checkAnyPermission } from '../permissions/check-permissions'
import ensureLoggedIn from '../session/ensure-logged-in'
import initSession from '../session/init'
import updateAllSessions from '../session/update-all-sessions'
import createThrottle from '../throttle/create-throttle'
import throttleMiddleware from '../throttle/middleware'
import { validateRequest } from '../validation/joi-validator'
import {
  attemptLogin,
  createUser,
  findSelfById,
  findUserById,
  findUserByName,
  findUsersById,
  updateUser,
  UserUpdatables,
} from './user-model'
import { getUserStats } from './user-stats-model'

const JOI_USER_ID = Joi.number().min(1)

const accountCreationThrottle = createThrottle('accountcreation', {
  rate: 1,
  burst: 4,
  window: 60000,
})

const accountUpdateThrottle = createThrottle('accountupdate', {
  rate: 10,
  burst: 20,
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

function hashPass(password: string): Promise<string> {
  return bcrypt.hash(password, 10 /* saltRounds */)
}

@httpApi('/users')
export class UserApi {
  constructor(private nydus: NydusServer) {}

  @httpPost('/')
  @httpBefore(throttleMiddleware(accountCreationThrottle, ctx => ctx.ip))
  async createUser(ctx: RouterContext): Promise<ClientSessionInfo> {
    const { username, password } = ctx.request.body
    const email = ctx.request.body.email.trim()

    if (!isValidUsername(username) || !isValidEmail(email) || !isValidPassword(password)) {
      throw new httpErrors.BadRequest('Invalid parameters')
    }

    const hashedPassword = await hashPass(password)

    let createdUser: { user: SelfUser; permissions: SbPermissions } | undefined
    try {
      createdUser = await createUser({ name: username, email, hashedPassword, ipAddress: ctx.ip })
    } catch (err: any) {
      if (err.code && err.code === UNIQUE_VIOLATION) {
        throw new httpErrors.Conflict('A user with that name already exists')
      }
      throw err
    }

    const sessionInfo: ClientSessionInfo = {
      user: createdUser.user,
      permissions: createdUser.permissions,
      lastQueuedMatchmakingType: MatchmakingType.Match1v1,
    }

    // regenerate the session to ensure that logged in sessions and anonymous sessions don't
    // share a session ID
    await ctx.regenerateSession()
    initSession(ctx, sessionInfo)

    const code = cuid()
    await addEmailVerificationCode(createdUser.user.id, email, code, ctx.ip)
    // No need to await for this
    sendMail({
      to: email,
      subject: 'ShieldBattery Email Verification',
      templateName: 'email-verification',
      templateData: { token: code },
    }).catch(err => ctx.log.error({ err, req: ctx.req }, 'Error sending email verification email'))

    return sessionInfo
  }

  @httpGet('/:id/profile')
  async getUserProfile(ctx: RouterContext): Promise<GetUserProfilePayload> {
    const { params } = validateRequest(ctx, {
      params: Joi.object<{ id: number }>({
        id: JOI_USER_ID.required(),
      }),
    })

    const user = await findUserById(params.id)
    if (!user) {
      // TODO(tec27): put the possible codes for this in common/
      throw new HttpErrorWithPayload(404, 'user not found', { code: 'USER_NOT_FOUND' })
    }

    const ladder: Partial<Record<MatchmakingType, LadderPlayer>> = {}
    // TODO(tec27): Make a function to get multiple types in one DB call?
    const matchmakingPromises = ALL_MATCHMAKING_TYPES.map(async m => {
      const r = await getRankForUser(user.id, m)
      if (r) {
        ladder[m] = {
          rank: r.rank,
          userId: r.userId,
          rating: r.rating,
          wins: r.wins,
          losses: r.losses,
          lastPlayedDate: Number(r.lastPlayedDate),
        }
      }
    })
    const userStatsPromise = getUserStats(user.id)

    const NUM_RECENT_GAMES = 6
    const matchHistoryPromise = (async () => {
      const games = await getRecentGamesForUser(user.id, NUM_RECENT_GAMES)
      const uniqueUsers = new Set<SbUserId>()
      const uniqueMaps = new Set<string>()
      for (const g of games) {
        uniqueMaps.add(g.mapId)

        for (const team of g.config.teams) {
          for (const player of team) {
            if (!player.isComputer) {
              uniqueUsers.add(player.id)
            }
          }
        }
      }
      const [users, maps] = await Promise.all([
        findUsersById(Array.from(uniqueUsers.values())),
        getMapInfo(Array.from(uniqueMaps.values())),
      ])

      return {
        games: games.map(g => toGameRecordJson(g)),
        maps: maps.map(m => toMapInfoJson(m)),
        users: Array.from(users.values()),
      }
    })()

    // TODO(tec27): I think these calls will be combine-able in later versions of TS, as of 4.3
    // the inference doesn't work for destructuring the results
    await Promise.all(matchmakingPromises)
    const [userStats, matchHistory] = await Promise.all([userStatsPromise, matchHistoryPromise])

    return {
      user,
      profile: { userId: user.id, ladder, userStats },
      matchHistory,
    }
  }

  @httpPatch('/:id')
  @httpBefore(
    ensureLoggedIn,
    throttleMiddleware(accountUpdateThrottle, ctx => String(ctx.session!.userId)),
  )
  async updateUser(ctx: RouterContext): Promise<SelfUser | undefined> {
    const { id: idString } = ctx.params
    const { currentPassword, newPassword, newEmail } = ctx.request.body

    const id = Number(idString)
    if (!id || isNaN(id)) {
      throw new httpErrors.BadRequest('Invalid parameters')
    } else if (ctx.session!.userId !== id) {
      throw new httpErrors.Unauthorized("Can't change another user's account")
    } else if (newPassword && !isValidPassword(newPassword)) {
      throw new httpErrors.BadRequest('Invalid parameters')
    } else if (newEmail && !isValidEmail(newEmail)) {
      throw new httpErrors.BadRequest('Invalid parameters')
    }

    // TODO(tec27): Updating certain things (e.g. title) might not need to require confirming the
    // current password, but maybe that should just be a different API
    if (!newPassword && !newEmail) {
      ctx.status = 204
      return undefined
    }

    if (!isValidPassword(currentPassword)) {
      throw new httpErrors.BadRequest('Invalid parameters')
    }

    const userInfo = await findUserById(id)
    if (!userInfo) {
      throw new httpErrors.Unauthorized('Incorrect user ID or password')
    }

    const oldUser = await attemptLogin(userInfo.name, currentPassword)
    if (!oldUser) {
      throw new httpErrors.Unauthorized('Incorrect user ID or password')
    }

    const oldEmail = oldUser.email

    const updates: Partial<UserUpdatables> = {}

    if (newPassword) {
      updates.password = await hashPass(newPassword)
    }
    if (newEmail) {
      updates.email = newEmail
      updates.emailVerified = false
    }
    const user = await updateUser(oldUser.id, updates)
    if (!user) {
      // NOTE(tec27): We want this to be a 5xx because this is a very unusual case, since we just
      // looked this user up above
      throw new Error("User couldn't be found")
    }

    // No need to await this before sending response to the user
    if (newPassword) {
      sendMail({
        to: user.email,
        subject: 'ShieldBattery Password Changed',
        templateName: 'password-change',
        templateData: { username: user.name },
      }).catch(err => ctx.log.error({ err, req: ctx.req }, 'Error sending password changed email'))
    }
    if (newEmail) {
      sendMail({
        to: oldEmail,
        subject: 'ShieldBattery Email Changed',
        templateName: 'email-change',
        templateData: { username: user.name },
      }).catch(err => ctx.log.error({ err, req: ctx.req }, 'Error sending email changed email'))

      const emailVerificationCode = cuid()
      await addEmailVerificationCode(user.id, user.email, emailVerificationCode, ctx.ip)
      await updateAllSessions(ctx, { emailVerified: false })

      sendMail({
        to: user.email,
        subject: 'ShieldBattery Email Verification',
        templateName: 'email-verification',
        templateData: { token: emailVerificationCode },
      }).catch(err => ctx.log.error({ err }, 'Error sending email verification email'))
    }

    return user
  }

  @httpPost('/:id/policies')
  @httpBefore(
    ensureLoggedIn,
    throttleMiddleware(accountUpdateThrottle, ctx => String(ctx.session!.userId)),
  )
  async acceptPolicies(ctx: RouterContext): Promise<AcceptPoliciesPayload> {
    const { params, body } = validateRequest(ctx, {
      params: Joi.object<{ id: number }>({
        id: JOI_USER_ID.required(),
      }),
      body: Joi.object<AcceptPoliciesBody>({
        policies: Joi.array()
          .items(
            Joi.array()
              .ordered(Joi.valid(...ALL_POLICY_TYPES).required(), Joi.number().required())
              .required(),
          )
          .min(1)
          .required(),
      }),
    })

    if (params.id !== ctx.session!.userId) {
      throw new httpErrors.Unauthorized("Can't change another user's account")
    }

    const updates: Partial<UserUpdatables> = {}
    for (const [policyType, version] of body.policies) {
      switch (policyType) {
        case SbPolicyType.Privacy:
          updates.acceptedPrivacyVersion = version
          break
        case SbPolicyType.TermsOfService:
          updates.acceptedTermsVersion = version
          break
        case SbPolicyType.AcceptableUse:
          updates.acceptedUsePolicyVersion = version
          break
        default:
          // TODO(tec27): Perhaps we should just skip this policy instead of 500ing?
          assertUnreachable(policyType)
      }
    }

    const user = await updateUser(params.id, updates)
    if (!user) {
      throw new Error("Current user couldn't be found for updating")
    }

    ctx.session!.acceptedPrivacyVersion = user.acceptedPrivacyVersion
    ctx.session!.acceptedTermsVersion = user.acceptedTermsVersion
    ctx.session!.acceptedUsePolicyVersion = user.acceptedUsePolicyVersion

    return { user }
  }

  @httpPost('/:username/password')
  async resetPassword(ctx: RouterContext): Promise<void> {
    // TODO(tec27): This request should probably be for a user ID
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

      const user = await findUserByName(username)
      if (!user) {
        throw new httpErrors.Conflict('User not found')
      }

      await updateUser(user.id, { password: await hashPass(password) })
    })

    ctx.status = 204
  }

  @httpPost('/emailVerification')
  @httpBefore(
    ensureLoggedIn,
    throttleMiddleware(emailVerificationThrottle, ctx => String(ctx.session!.userId)),
  )
  async verifyEmail(ctx: RouterContext): Promise<void> {
    const { code } = ctx.query

    if (!code) {
      throw new httpErrors.BadRequest('Invalid parameters')
    }

    const user = await findSelfById(ctx.session!.userId)
    if (!user) {
      throw new httpErrors.BadRequest('User not found')
    }

    const emailVerified = await consumeEmailVerificationCode(user.id, user.email, code)
    if (!emailVerified) {
      throw new httpErrors.BadRequest('Email verification code is invalid')
    }

    // Update all of the user's sessions to indicate that their email is now indeed verified.
    await updateAllSessions(ctx, { emailVerified: true })
    // We update this session specifically as well, to ensure that any previous changes to the
    // session during this request don't cause a stale value to be written
    ctx.session!.emailVerified = true

    // Last thing to do is to notify all of the user's opened sockets that their email is now
    // verified
    // NOTE(2Pac): With the way the things are currently set up on client (their socket is not
    // connected when they open the email verification page), the client making the request won't
    // actually get this event. Thankfully, that's easy to deal with on the client-side.
    this.nydus.publish('/userProfiles/' + ctx.session!.userId, { action: 'emailVerified' })
    // TODO(tec27): get the above path from UserSocketsGroup instead of just concat'ing things
    // together here

    ctx.status = 204
  }

  @httpPost('/sendVerification')
  @httpBefore(
    ensureLoggedIn,
    throttleMiddleware(sendVerificationThrottle, ctx => String(ctx.session!.userId)),
  )
  async sendVerificationEmail(ctx: RouterContext): Promise<void> {
    const user = await findSelfById(ctx.session!.userId)
    if (!user) {
      throw new httpErrors.BadRequest('User not found')
    }

    const emailVerificationsCount = await getEmailVerificationsCount(user.id, user.email)
    if (emailVerificationsCount > 10) {
      throw new httpErrors.Conflict('Email is over verification limit')
    }

    const code = cuid()
    await addEmailVerificationCode(user.id, user.email, code, ctx.ip)
    // No need to await for this
    sendMail({
      to: user.email,
      subject: 'ShieldBattery Email Verification',
      templateName: 'email-verification',
      templateData: { token: code },
    }).catch(err => ctx.log.error({ err }, 'Error sending email verification email'))

    ctx.status = 204
  }
}

@httpApi('/admin/users')
export class AdminUserApi {
  @httpGet('/:searchTerm')
  @httpBefore(checkAnyPermission('banUsers', 'editPermissions'))
  async findUser(ctx: RouterContext): Promise<SbUser[]> {
    const searchTerm = ctx.params.searchTerm

    try {
      // TODO(tec27): Admins probably want more info than just this, maybe we should merge some of
      // this functionality with the profile page
      const user = await findUserByName(searchTerm)
      return user ? [user] : []
    } catch (err) {
      throw err
    }
  }
}
