import { RouterContext } from '@koa/router'
import bcrypt from 'bcrypt'
import cuid from 'cuid'
import httpErrors from 'http-errors'
import Joi from 'joi'
import { assertUnreachable } from '../../../common/assert-unreachable'
import {
  EMAIL_MAXLENGTH,
  EMAIL_MINLENGTH,
  EMAIL_PATTERN,
  isValidEmail,
  isValidPassword,
  isValidUsername,
  PASSWORD_MINLENGTH,
  USERNAME_MAXLENGTH,
  USERNAME_MINLENGTH,
  USERNAME_PATTERN,
} from '../../../common/constants'
import { toGameRecordJson } from '../../../common/games/games'
import { LadderPlayer } from '../../../common/ladder'
import { toMapInfoJson } from '../../../common/maps'
import {
  ALL_MATCHMAKING_TYPES,
  MatchmakingType,
  NUM_PLACEMENT_MATCHES,
} from '../../../common/matchmaking'
import { ALL_POLICY_TYPES, SbPolicyType } from '../../../common/policies/policy-type'
import { SbPermissions } from '../../../common/users/permissions'
import {
  GetRelationshipsResponse,
  ModifyRelationshipResponse,
  toUserRelationshipJson,
  toUserRelationshipSummaryJson,
} from '../../../common/users/relationships'
import {
  AcceptPoliciesRequest,
  AcceptPoliciesResponse,
  AdminBanUserRequest,
  AdminBanUserResponse,
  AdminGetBansResponse,
  AdminGetPermissionsResponse,
  AdminGetUserIpsResponse,
  AdminUpdatePermissionsRequest,
  AuthEvent,
  GetBatchUserInfoResponse,
  GetUserProfileResponse,
  SbUser,
  SbUserId,
  SelfUser,
  toBanHistoryEntryJson,
  toUserIpInfoJson,
  UserErrorCode,
} from '../../../common/users/sb-user'
import { ClientSessionInfo } from '../../../common/users/session'
import { UNIQUE_VIOLATION } from '../db/pg-error-codes'
import transact from '../db/transaction'
import { getRecentGamesForUser } from '../games/game-models'
import { httpApi, httpBeforeAll } from '../http/http-api'
import { httpBefore, httpDelete, httpGet, httpPatch, httpPost } from '../http/route-decorators'
import sendMail from '../mail/mailer'
import { getMapInfo } from '../maps/map-models'
import { getRankForUser } from '../matchmaking/models'
import { usePasswordResetCode } from '../models/password-resets'
import { getPermissions, updatePermissions } from '../models/permissions'
import { isElectronClient } from '../network/only-web-clients'
import { checkAllPermissions, checkAnyPermission } from '../permissions/check-permissions'
import ensureLoggedIn from '../session/ensure-logged-in'
import initSession from '../session/init'
import { updateAllSessions, updateAllSessionsForCurrentUser } from '../session/update-all-sessions'
import createThrottle from '../throttle/create-throttle'
import throttleMiddleware from '../throttle/middleware'
import { validateRequest } from '../validation/joi-validator'
import { TypedPublisher } from '../websockets/typed-publisher'
import { BanEnacter } from './ban-enacter'
import { retrieveBanHistory } from './ban-models'
import { joiClientIdentifiers } from './client-ids'
import {
  addEmailVerificationCode,
  consumeEmailVerificationCode,
  getEmailVerificationsCount,
} from './email-verification-models'
import { SuspiciousIpsService } from './suspicious-ips'
import {
  convertUserApiErrors,
  convertUserRelationshipServiceErrors,
  UserApiError,
} from './user-api-errors'
import { UserIdentifierManager } from './user-identifier-manager'
import { retrieveIpsForUser, retrieveRelatedUsersForIps } from './user-ips'
import {
  attemptLogin,
  createUser,
  findSelfById,
  findUserById,
  findUserByName,
  findUsersById,
  retrieveUserCreatedDate,
  updateUser,
  UserUpdatables,
} from './user-model'
import { UserRelationshipService } from './user-relationship-service'
import { getUserStats } from './user-stats-model'
import { joiUserId } from './user-validators'

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

const accountRetrievalThrottle = createThrottle('accountretrieval', {
  rate: 40,
  burst: 80,
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

const relationshipsThrottle = createThrottle('accountrelationships', {
  rate: 5,
  burst: 25,
  window: 60000,
})

function hashPass(password: string): Promise<string> {
  return bcrypt.hash(password, 10 /* saltRounds */)
}

function sendVerificationEmail({
  email,
  code,
  userId,
  username,
}: {
  email: string
  code: string
  userId: SbUserId
  username: string
}) {
  return sendMail({
    to: email,
    subject: 'ShieldBattery Email Verification',
    templateName: 'email-verification',
    templateData: { token: code, userId, username },
  })
}

interface SignupRequestBody {
  username: string
  password: string
  email: string
  clientIds: [type: number, hash: string][]
}

@httpApi('/users')
@httpBeforeAll(convertUserApiErrors, convertUserRelationshipServiceErrors)
export class UserApi {
  constructor(
    private publisher: TypedPublisher<AuthEvent>,
    private suspiciousIps: SuspiciousIpsService,
    private userIdManager: UserIdentifierManager,
    private userRelationshipService: UserRelationshipService,
  ) {}

  @httpPost('/')
  @httpBefore(throttleMiddleware(accountCreationThrottle, ctx => ctx.ip))
  async createUser(ctx: RouterContext): Promise<ClientSessionInfo> {
    const { body } = validateRequest(ctx, {
      body: Joi.object<SignupRequestBody>({
        username: Joi.string()
          .min(USERNAME_MINLENGTH)
          .max(USERNAME_MAXLENGTH)
          .pattern(USERNAME_PATTERN)
          .required(),
        password: Joi.string().min(PASSWORD_MINLENGTH).required(),
        email: Joi.string()
          .min(EMAIL_MINLENGTH)
          .max(EMAIL_MAXLENGTH)
          .pattern(EMAIL_PATTERN)
          .trim()
          .required(),
        clientIds: joiClientIdentifiers().required(),
      }),
    })

    const { username, password, email, clientIds } = body

    if (!isElectronClient(ctx)) {
      const [suspicious, signupAllowed] = await Promise.all([
        this.suspiciousIps.isIpSuspicious(ctx.ip),
        this.userIdManager.isSignupAllowed(true, clientIds),
      ])

      if (suspicious || !signupAllowed) {
        throw new UserApiError(
          UserErrorCode.SuspiciousActivity,
          'Suspicious activity detected, creating accounts on the web is disabled',
        )
      }
    } else {
      const signupAllowed = await this.userIdManager.isSignupAllowed(false, clientIds)
      if (!signupAllowed) {
        throw new UserApiError(
          UserErrorCode.MachineBanned,
          'This machine is banned from creating new accounts',
        )
      }
    }

    const hashedPassword = await hashPass(password)

    let createdUser: { user: SelfUser; permissions: SbPermissions } | undefined
    try {
      createdUser = await createUser({
        name: username,
        email,
        hashedPassword,
        ipAddress: ctx.ip,
        clientIds,
      })
    } catch (err: any) {
      if (err.code && err.code === UNIQUE_VIOLATION) {
        throw new UserApiError(UserErrorCode.UsernameTaken, 'A user with that name already exists')
      }
      throw err
    }

    // If this is the first user ever created, give them the ability to edit permissions. This
    // mostly just makes it easier to get started in development and tests.
    if (createdUser.user.id === 1) {
      await updatePermissions(createdUser.user.id, {
        ...createdUser.permissions,
        editPermissions: true,
      })
      createdUser.permissions.editPermissions = true
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
    await addEmailVerificationCode({ userId: createdUser.user.id, email, code, ip: ctx.ip })
    // No need to await for this
    sendVerificationEmail({
      email,
      code,
      userId: createdUser.user.id,
      username: createdUser.user.name,
    }).catch(err => ctx.log.error({ err, req: ctx.req }, 'Error sending email verification email'))

    return sessionInfo
  }

  @httpGet('/:id/profile')
  @httpBefore(
    ensureLoggedIn,
    throttleMiddleware(accountRetrievalThrottle, ctx => String(ctx.session!.userId)),
  )
  async getUserProfile(ctx: RouterContext): Promise<GetUserProfileResponse> {
    const { params } = validateRequest(ctx, {
      params: Joi.object<{ id: SbUserId }>({
        id: joiUserId().required(),
      }),
    })

    const user = await findUserById(params.id)
    if (!user) {
      throw new UserApiError(UserErrorCode.NotFound, 'user not found')
    }

    const ladder: Partial<Record<MatchmakingType, LadderPlayer>> = {}
    // TODO(tec27): Make a function to get multiple types in one DB call?
    const matchmakingPromises = ALL_MATCHMAKING_TYPES.map(async m => {
      const r = await getRankForUser(user.id, m)
      if (r) {
        ladder[m] = {
          rank: r.rank,
          userId: r.userId,
          rating: r.lifetimeGames >= NUM_PLACEMENT_MATCHES ? r.rating : 0,
          points: r.points,
          bonusUsed: r.bonusUsed,
          wins: r.wins,
          losses: r.losses,
          lifetimeGames: r.lifetimeGames,
          pWins: r.pWins,
          pLosses: r.pLosses,
          tWins: r.tWins,
          tLosses: r.tLosses,
          zWins: r.zWins,
          zLosses: r.zLosses,
          rWins: r.rWins,
          rLosses: r.rLosses,
          rPWins: r.rPWins,
          rPLosses: r.rPLosses,
          rTWins: r.rTWins,
          rTLosses: r.rTLosses,
          rZWins: r.rZWins,
          rZLosses: r.rZLosses,
          lastPlayedDate: Number(r.lastPlayedDate),
        }
      }
    })
    const userStatsPromise = getUserStats(user.id)
    const createdDatePromise = retrieveUserCreatedDate(user.id)

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
        users,
      }
    })()

    // TODO(tec27): I think these calls will be combine-able in later versions of TS, as of 4.3
    // the inference doesn't work for destructuring the results
    await Promise.all(matchmakingPromises)
    const [userStats, matchHistory, createdDate] = await Promise.all([
      userStatsPromise,
      matchHistoryPromise,
      createdDatePromise,
    ])

    return {
      user,
      profile: { userId: user.id, created: Number(createdDate), ladder, userStats },
      matchHistory,
    }
  }

  @httpGet('/batch-info')
  @httpBefore(
    ensureLoggedIn,
    throttleMiddleware(accountRetrievalThrottle, ctx => String(ctx.session!.userId)),
  )
  async batchGetInfo(ctx: RouterContext): Promise<GetBatchUserInfoResponse> {
    const { query } = validateRequest(ctx, {
      query: Joi.object<{ u: SbUserId[] }>({
        u: Joi.array().items(joiUserId()).single().min(1).max(20),
      }),
    })

    const userIds = query.u
    const users = await findUsersById(userIds)

    return {
      userInfos: users,
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
      await addEmailVerificationCode({
        userId: user.id,
        email: user.email,
        code: emailVerificationCode,
        ip: ctx.ip,
      })
      await updateAllSessionsForCurrentUser(ctx, { emailVerified: false })

      sendVerificationEmail({
        email: user.email,
        code: emailVerificationCode,
        userId: user.id,
        username: user.name,
      }).catch(err => ctx.log.error({ err }, 'Error sending email verification email'))
    }

    return user
  }

  @httpPost('/:id/policies')
  @httpBefore(
    ensureLoggedIn,
    throttleMiddleware(accountUpdateThrottle, ctx => String(ctx.session!.userId)),
  )
  async acceptPolicies(ctx: RouterContext): Promise<AcceptPoliciesResponse> {
    const { params, body } = validateRequest(ctx, {
      params: Joi.object<{ id: SbUserId }>({
        id: joiUserId().required(),
      }),
      body: Joi.object<AcceptPoliciesRequest>({
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

  @httpPost('/:id/email-verification/send')
  @httpBefore(
    ensureLoggedIn,
    throttleMiddleware(sendVerificationThrottle, ctx => String(ctx.session!.userId)),
  )
  async resendVerificationEmail(ctx: RouterContext): Promise<void> {
    const { params } = validateRequest(ctx, {
      params: Joi.object<{ id: SbUserId }>({
        id: joiUserId().valid(ctx.session!.userId).required(),
      }),
    })

    const user = await findSelfById(params.id)
    if (!user) {
      throw new httpErrors.BadRequest('User not found')
    }

    const emailVerificationsCount = await getEmailVerificationsCount({
      id: user.id,
      email: user.email,
    })
    if (emailVerificationsCount > 10) {
      throw new httpErrors.Conflict('Email is over verification limit')
    }

    const code = cuid()
    await addEmailVerificationCode({ userId: user.id, email: user.email, code, ip: ctx.ip })
    await sendVerificationEmail({
      email: user.email,
      code,
      userId: user.id,
      username: user.name,
    })

    ctx.status = 204
  }

  @httpPost('/:id/email-verification')
  @httpBefore(
    ensureLoggedIn,
    throttleMiddleware(emailVerificationThrottle, ctx => String(ctx.session!.userId)),
  )
  async verifyEmail(ctx: RouterContext): Promise<void> {
    const {
      params,
      body: { code },
    } = validateRequest(ctx, {
      params: Joi.object<{ id: SbUserId }>({
        id: joiUserId().valid(ctx.session!.userId).required(),
      }),
      body: Joi.object<{ code: string }>({
        code: Joi.string().required(),
      }),
    })

    const user = await findSelfById(params.id)
    if (!user) {
      throw new UserApiError(UserErrorCode.NotFound, 'user not found')
    }

    const emailVerified = await consumeEmailVerificationCode({
      id: user.id,
      email: user.email,
      code,
    })
    if (!emailVerified) {
      throw new UserApiError(UserErrorCode.InvalidCode, 'invalid code')
    }

    // Update all of the user's sessions to indicate that their email is now indeed verified.
    await updateAllSessionsForCurrentUser(ctx, { emailVerified: true })
    // We update this session specifically as well, to ensure that any previous changes to the
    // session during this request don't cause a stale value to be written
    ctx.session!.emailVerified = true

    // Last thing to do is to notify all of the user's opened sockets that their email is now
    // verified
    // NOTE(2Pac): With the way the things are currently set up on client (their socket is not
    // connected when they open the email verification page), the client making the request won't
    // actually get this event. Thankfully, that's easy to deal with on the client-side.
    this.publisher.publish(`/userProfiles/${user.id}`, {
      action: 'emailVerified',
      userId: user.id,
    })

    ctx.status = 204
  }

  @httpGet('/:id/relationships')
  @httpBefore(
    ensureLoggedIn,
    throttleMiddleware(accountRetrievalThrottle, ctx => String(ctx.session!.userId)),
  )
  async getRelationships(ctx: RouterContext): Promise<GetRelationshipsResponse> {
    const { params } = validateRequest(ctx, {
      params: Joi.object<{ id: SbUserId }>({
        id: joiUserId().valid(ctx.session!.userId).required(),
      }),
    })

    const summary = await this.userRelationshipService.getRelationshipSummary(params.id)

    const allUserIds = [
      summary.blocks.map(b => b.toId),
      summary.friends.map(f => f.toId),
      summary.outgoingRequests.map(r => r.toId),
      summary.incomingRequests.map(r => r.fromId),
    ].flat()
    const users = await findUsersById(allUserIds)

    return { summary: toUserRelationshipSummaryJson(summary), users }
  }

  @httpPost('/:id/relationships/friend-requests')
  @httpBefore(
    ensureLoggedIn,
    throttleMiddleware(relationshipsThrottle, ctx => String(ctx.session!.userId)),
  )
  async sendFriendRequest(ctx: RouterContext): Promise<ModifyRelationshipResponse> {
    const { params } = validateRequest(ctx, {
      params: Joi.object<{ id: SbUserId }>({
        id: joiUserId().required(),
      }),
    })

    const user = await findUserById(params.id)
    if (!user) {
      throw new UserApiError(UserErrorCode.NotFound, 'user not found')
    }

    const relationship = await this.userRelationshipService.sendFriendRequest(
      ctx.session!.userId,
      user.id,
    )

    return { relationship: toUserRelationshipJson(relationship), user }
  }

  @httpDelete('/:toId/relationships/friend-requests/:fromId')
  @httpBefore(
    ensureLoggedIn,
    throttleMiddleware(relationshipsThrottle, ctx => String(ctx.session!.userId)),
  )
  async removeFriendRequest(ctx: RouterContext): Promise<void> {
    const {
      params: { toId, fromId },
    } = validateRequest(ctx, {
      params: Joi.object<{ toId: SbUserId; fromId: SbUserId }>({
        toId: joiUserId().required(),
        fromId: joiUserId().required(),
      }),
    })

    if (toId !== ctx.session!.userId && fromId !== ctx.session!.userId) {
      throw new httpErrors.BadRequest('Can only manage your own friend requests')
    }
    const otherUser = toId === ctx.session!.userId ? fromId : toId

    const user = await findUserById(otherUser)
    if (!user) {
      throw new UserApiError(UserErrorCode.NotFound, 'user not found')
    }

    await this.userRelationshipService.removeFriendRequest(fromId, toId)

    ctx.status = 204
  }

  @httpPost('/:toId/relationships/friends/:fromId')
  @httpBefore(
    ensureLoggedIn,
    throttleMiddleware(relationshipsThrottle, ctx => String(ctx.session!.userId)),
  )
  async acceptFriendRequest(ctx: RouterContext): Promise<ModifyRelationshipResponse> {
    const {
      params: { toId, fromId },
    } = validateRequest(ctx, {
      params: Joi.object<{ toId: SbUserId; fromId: SbUserId }>({
        toId: joiUserId().valid(ctx.session!.userId).required(),
        fromId: joiUserId().required(),
      }),
    })

    const user = await findUserById(fromId)
    if (!user) {
      throw new UserApiError(UserErrorCode.NotFound, 'user not found')
    }

    const relationship = await this.userRelationshipService.acceptFriendRequest(toId, fromId)

    return { relationship: toUserRelationshipJson(relationship), user }
  }

  @httpDelete('/:removerId/relationships/friends/:targetId')
  @httpBefore(
    ensureLoggedIn,
    throttleMiddleware(relationshipsThrottle, ctx => String(ctx.session!.userId)),
  )
  async removeFriend(ctx: RouterContext): Promise<void> {
    const {
      params: { removerId, targetId },
    } = validateRequest(ctx, {
      params: Joi.object<{ removerId: SbUserId; targetId: SbUserId }>({
        removerId: joiUserId().valid(ctx.session!.userId).required(),
        targetId: joiUserId().required(),
      }),
    })

    const user = await findUserById(targetId)
    if (!user) {
      throw new UserApiError(UserErrorCode.NotFound, 'user not found')
    }

    await this.userRelationshipService.removeFriend(removerId, targetId)

    ctx.status = 204
  }

  @httpPost('/:blockerId/relationships/blocks/:targetId')
  @httpBefore(
    ensureLoggedIn,
    throttleMiddleware(relationshipsThrottle, ctx => String(ctx.session!.userId)),
  )
  async blockUser(ctx: RouterContext): Promise<ModifyRelationshipResponse> {
    const {
      params: { blockerId, targetId },
    } = validateRequest(ctx, {
      params: Joi.object<{ blockerId: SbUserId; targetId: SbUserId }>({
        blockerId: joiUserId().valid(ctx.session!.userId).required(),
        targetId: joiUserId().required(),
      }),
    })

    const user = await findUserById(targetId)
    if (!user) {
      throw new UserApiError(UserErrorCode.NotFound, 'user not found')
    }

    const relationship = await this.userRelationshipService.blockUser(blockerId, targetId)

    return { relationship: toUserRelationshipJson(relationship), user }
  }

  @httpDelete('/:unblockerId/relationships/blocks/:targetId')
  @httpBefore(
    ensureLoggedIn,
    throttleMiddleware(relationshipsThrottle, ctx => String(ctx.session!.userId)),
  )
  async unblockUser(ctx: RouterContext): Promise<void> {
    const {
      params: { unblockerId, targetId },
    } = validateRequest(ctx, {
      params: Joi.object<{ unblockerId: SbUserId; targetId: SbUserId }>({
        unblockerId: joiUserId().valid(ctx.session!.userId).required(),
        targetId: joiUserId().required(),
      }),
    })

    const user = await findUserById(targetId)
    if (!user) {
      throw new UserApiError(UserErrorCode.NotFound, 'user not found')
    }

    await this.userRelationshipService.unblockUser(unblockerId, targetId)

    ctx.status = 204
  }
}

@httpApi('/admin/users')
@httpBeforeAll(convertUserApiErrors, ensureLoggedIn)
export class AdminUserApi {
  constructor(private publisher: TypedPublisher<AuthEvent>, private banEnacter: BanEnacter) {}

  @httpGet('/:id/permissions')
  @httpBefore(checkAllPermissions('editPermissions'))
  async getPermissions(ctx: RouterContext): Promise<AdminGetPermissionsResponse> {
    const { params } = validateRequest(ctx, {
      params: Joi.object<{ id: SbUserId }>({
        id: joiUserId().required(),
      }),
    })

    const [user, permissions] = await Promise.all([
      findUserById(params.id),
      getPermissions(params.id),
    ])
    if (!user || !permissions) {
      throw new UserApiError(UserErrorCode.NotFound, 'user not found')
    }

    return {
      user,
      permissions,
    }
  }

  @httpPost('/:id/permissions')
  @httpBefore(checkAllPermissions('editPermissions'))
  async updatePermissions(ctx: RouterContext): Promise<void> {
    const { params, body } = validateRequest(ctx, {
      params: Joi.object<{ id: SbUserId }>({
        id: joiUserId().required(),
      }),
      body: Joi.object<AdminUpdatePermissionsRequest>({
        permissions: Joi.object<SbPermissions>({
          editPermissions: Joi.boolean().required(),
          debug: Joi.boolean().required(),
          banUsers: Joi.boolean().required(),
          manageMaps: Joi.boolean().required(),
          manageMapPools: Joi.boolean().required(),
          manageMatchmakingSeasons: Joi.boolean().required(),
          manageMatchmakingTimes: Joi.boolean().required(),
          manageRallyPointServers: Joi.boolean().required(),
          massDeleteMaps: Joi.boolean().required(),
          moderateChatChannels: Joi.boolean().required(),
        }).required(),
      }),
    })

    const permissions = await updatePermissions(params.id, body.permissions)

    if (!permissions) {
      throw new UserApiError(UserErrorCode.NotFound, 'user not found')
    }

    if (ctx.session!.userId === params.id) {
      await updateAllSessionsForCurrentUser(ctx, { permissions })
    } else {
      await updateAllSessions(params.id, { permissions })
    }
    this.publisher.publish(`/userProfiles/${params.id}`, {
      action: 'permissionsChanged',
      userId: params.id,
      permissions,
    })

    ctx.status = 204
  }

  @httpGet('/:id/bans')
  @httpBefore(checkAllPermissions('banUsers'))
  async getBans(ctx: RouterContext): Promise<AdminGetBansResponse> {
    const { params } = validateRequest(ctx, {
      params: Joi.object<{ id: SbUserId }>({
        id: joiUserId().required(),
      }),
    })

    const [user, banHistory] = await Promise.all([
      findUserById(params.id),
      retrieveBanHistory(params.id),
    ])

    if (!user) {
      throw new UserApiError(UserErrorCode.NotFound, 'user not found')
    }

    const banningUserIds = Array.from(
      new Set(banHistory.map(b => b.bannedBy).filter((i): i is SbUserId => i !== undefined)),
    )

    const banningUsers = banHistory.length ? await findUsersById(banningUserIds) : []

    return {
      forUser: params.id,
      bans: banHistory.map(b => toBanHistoryEntryJson(b)),
      users: banningUsers.concat(user),
    }
  }

  @httpPost('/:id/bans')
  @httpBefore(checkAllPermissions('banUsers'))
  async banUser(ctx: RouterContext): Promise<AdminBanUserResponse> {
    const { params, body } = validateRequest(ctx, {
      params: Joi.object<{ id: SbUserId }>({
        id: joiUserId().required(),
      }),
      body: Joi.object<AdminBanUserRequest>({
        banLengthHours: Joi.number().required(),
        reason: Joi.string(),
      }).required(),
    })

    if (params.id === ctx.session!.userId) {
      throw new UserApiError(UserErrorCode.NotAllowedOnSelf, "can't ban yourself")
    }

    const user = await findUserById(params.id)
    if (!user) {
      throw new UserApiError(UserErrorCode.NotFound, 'user not found')
    }

    const [ban, bannedBy] = await Promise.all([
      this.banEnacter.enactBan({
        targetId: user.id,
        bannedBy: ctx.session!.userId,
        banLengthHours: body.banLengthHours,
        reason: body.reason,
      }),
      await findUserById(ctx.session!.userId),
    ])

    // This would be a really weird occurrence! So we just make sure we do the actual banning before
    // this, and let the 500 pass through after
    if (!bannedBy) {
      throw new Error("couldn't find current user")
    }

    return {
      ban: toBanHistoryEntryJson(ban),
      users: [user, bannedBy],
    }
  }

  @httpGet('/:id/ips')
  @httpBefore(checkAllPermissions('banUsers'))
  async getIps(ctx: RouterContext): Promise<AdminGetUserIpsResponse> {
    const { params } = validateRequest(ctx, {
      params: Joi.object<{ id: SbUserId }>({
        id: joiUserId().required(),
      }),
    })

    const user = await findUserById(params.id)
    if (!user) {
      throw new UserApiError(UserErrorCode.NotFound, 'user not found')
    }

    const ips = await retrieveIpsForUser(user.id)
    if (!ips.length) {
      return {
        forUser: user.id,
        ips: [],
        relatedUsers: [],
        users: [user],
      }
    }

    const relatedUsers = await retrieveRelatedUsersForIps(
      ips.map(i => i.ipAddress),
      user.id,
    )

    const otherUserIds = Array.from(
      new Set(Array.from(relatedUsers.values(), v => v.map(info => info.userId)).flat()),
    )
    const otherUsers = await findUsersById(otherUserIds)

    return {
      forUser: user.id,
      ips: ips.map(i => toUserIpInfoJson(i)),
      relatedUsers: Array.from(relatedUsers.entries(), ([ip, infos]) => [
        ip,
        infos.map(i => toUserIpInfoJson(i)),
      ]),
      users: otherUsers.concat(user),
    }
  }

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
