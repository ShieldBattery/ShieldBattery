import { RouterContext } from '@koa/router'
import bcrypt from 'bcrypt'
import cuid from 'cuid'
import httpErrors from 'http-errors'
import Joi from 'joi'
import uid from 'uid-safe'
import { assertUnreachable } from '../../../common/assert-unreachable'
import {
  EMAIL_MAXLENGTH,
  EMAIL_MINLENGTH,
  EMAIL_PATTERN,
  isValidPassword,
  isValidUsername,
  PASSWORD_MINLENGTH,
  USERNAME_MAXLENGTH,
  USERNAME_MINLENGTH,
  USERNAME_PATTERN,
} from '../../../common/constants'
import { toGameRecordJson } from '../../../common/games/games'
import { ALL_TRANSLATION_LANGUAGES } from '../../../common/i18n'
import { LadderPlayer } from '../../../common/ladder/ladder'
import { toMapInfoJson } from '../../../common/maps'
import {
  MatchmakingType,
  NUM_PLACEMENT_MATCHES,
  toMatchmakingSeasonJson,
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
  AdminGetUserIpsResponse,
  AuthEvent,
  ChangeLanguageRequest,
  ChangeLanguagesResponse,
  GetBatchUserInfoResponse,
  GetUserProfileResponse,
  GetUserRankingHistoryResponse,
  SbUser,
  SEARCH_MATCH_HISTORY_LIMIT,
  SearchMatchHistoryResponse,
  SelfUser,
  toBanHistoryEntryJson,
  toUserIpInfoJson,
  UserErrorCode,
} from '../../../common/users/sb-user'
import { SbUserId } from '../../../common/users/sb-user-id'
import { ClientSessionInfo } from '../../../common/users/session'
import { UNIQUE_VIOLATION } from '../db/pg-error-codes'
import transact from '../db/transaction'
import { getRecentGamesForUser, searchGamesForUser } from '../games/game-models'
import { httpApi, httpBeforeAll } from '../http/http-api'
import { httpBefore, httpDelete, httpGet, httpPost } from '../http/route-decorators'
import { joiLocale } from '../i18n/locale-validator'
import { getRankingsForUser } from '../ladder/rankings'
import { sendMailTemplate } from '../mail/mailer'
import { getMapInfo } from '../maps/map-models'
import { MatchmakingSeasonsService } from '../matchmaking/matchmaking-seasons'
import {
  getMatchmakingFinalizedRanksForUser,
  getMatchmakingRatingsForUser,
  getMatchmakingSeasonsByIds,
} from '../matchmaking/models'
import { usePasswordResetCode } from '../models/password-resets'
import { updatePermissions } from '../models/permissions'
import { isElectronClient } from '../network/only-web-clients'
import { checkAllPermissions, checkAnyPermission } from '../permissions/check-permissions'
import { Redis } from '../redis/redis'
import ensureLoggedIn from '../session/ensure-logged-in'
import { getJwt } from '../session/jwt-session-middleware'
import createThrottle from '../throttle/create-throttle'
import throttleMiddleware from '../throttle/middleware'
import { Clock } from '../time/clock'
import { validateRequest } from '../validation/joi-validator'
import { TypedPublisher } from '../websockets/typed-publisher'
import { BanEnacter } from './ban-enacter'
import { retrieveBanHistory } from './ban-models'
import { joiClientIdentifiers } from './client-ids'
import { addEmailVerificationCode, getEmailVerificationsCount } from './email-verification-models'
import { SuspiciousIpsService } from './suspicious-ips'
import {
  convertUserApiErrors,
  convertUserRelationshipServiceErrors,
  UserApiError,
} from './user-api-errors'
import { UserIdentifierCleanupJob } from './user-identifier-cleanup'
import { UserIdentifierManager } from './user-identifier-manager'
import { retrieveIpsForUser, retrieveRelatedUsersForIps } from './user-ips'
import {
  createUser,
  findSelfById,
  findUserById,
  findUserByName,
  findUsersById,
  retrieveUserCreatedDate,
  UserUpdatables,
} from './user-model'
import { UserRelationshipService } from './user-relationship-service'
import { UserService } from './user-service'
import { getUserStats } from './user-stats-model'
import { joiUserId } from './user-validators'

// Env var that lets us turn throttling off for testing
const THROTTLING_DISABLED = Boolean(process.env.SB_DISABLE_THROTTLING ?? false)

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

const matchHistoryRetrievalThrottle = createThrottle('matchhistoryretrieval', {
  rate: 50,
  burst: 150,
  window: 60000,
})

const rankingsHistoryRetrievalThrottle = createThrottle('rankingshistoryretrieval', {
  rate: 10,
  burst: 30,
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
  return bcrypt.hash(password, 11 /* saltRounds */)
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
  return sendMailTemplate({
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
  locale?: string
}

@httpApi('/users')
@httpBeforeAll(convertUserApiErrors, convertUserRelationshipServiceErrors)
export class UserApi {
  // eslint-disable-next-line max-params
  constructor(
    private publisher: TypedPublisher<AuthEvent>,
    private suspiciousIps: SuspiciousIpsService,
    private userIdManager: UserIdentifierManager,
    private userRelationshipService: UserRelationshipService,
    // NOTE(tec27): Don't delete this. It shouldn't get garbage collected anyway since it's a
    // singleton, but better safe than sorry for future code changes :)
    private _userIdentifierCleanup: UserIdentifierCleanupJob,
    private userService: UserService,
    private clock: Clock,
    private redis: Redis,
    private matchmakingSeasonsService: MatchmakingSeasonsService,
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
        locale: joiLocale(),
      }),
    })

    const { username, password, email, clientIds, locale } = body

    if (!THROTTLING_DISABLED) {
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
        locale,
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

    await ctx.beginSession(createdUser.user.id, false)

    const code = await uid(12)
    await addEmailVerificationCode({ userId: createdUser.user.id, email, code, ip: ctx.ip })
    // No need to await for this
    sendVerificationEmail({
      email,
      code,
      userId: createdUser.user.id,
      username: createdUser.user.name,
    }).catch(err => ctx.log.error({ err, req: ctx.req }, 'Error sending email verification email'))

    return { ...ctx.session!, jwt: await getJwt(ctx, this.clock.now()) }
  }

  @httpGet('/:id/profile')
  @httpBefore(
    throttleMiddleware(accountRetrievalThrottle, ctx => String(ctx.session?.user?.id ?? ctx.ip)),
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

    const currentSeason = await this.matchmakingSeasonsService.getCurrentSeason()
    const ratingsPromise = getMatchmakingRatingsForUser(user.id, currentSeason.id)
    const rankingsPromise = getRankingsForUser(this.redis, user.id, currentSeason.id)

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

    const [userStats, matchHistory, createdDate, ratings, rankings] = await Promise.all([
      userStatsPromise,
      matchHistoryPromise,
      createdDatePromise,
      ratingsPromise,
      rankingsPromise,
    ])

    const ladder: Partial<Record<MatchmakingType, LadderPlayer>> = {}
    for (const r of ratings) {
      ladder[r.matchmakingType] = {
        userId: r.userId,
        matchmakingType: r.matchmakingType,
        seasonId: r.seasonId,
        rank: rankings.get(r.matchmakingType) ?? -1,
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

    return {
      user,
      profile: {
        userId: user.id,
        created: Number(createdDate),
        ladder,
        seasonId: currentSeason.id,
        userStats,
      },
      matchHistory,
      seasons: [toMatchmakingSeasonJson(currentSeason)],
    }
  }

  @httpGet('/:id/match-history')
  @httpBefore(
    throttleMiddleware(matchHistoryRetrievalThrottle, ctx =>
      String(ctx.session?.user?.id ?? ctx.ip),
    ),
  )
  async searchMatchHistory(ctx: RouterContext): Promise<SearchMatchHistoryResponse> {
    const {
      params,
      query: { offset },
    } = validateRequest(ctx, {
      params: Joi.object<{ id: SbUserId }>({
        id: joiUserId().required(),
      }),
      query: Joi.object<{ q?: string; offset: number }>({
        q: Joi.string().allow(''),
        offset: Joi.number().min(0),
      }),
    })

    const user = await findUserById(params.id)
    if (!user) {
      throw new UserApiError(UserErrorCode.NotFound, 'user not found')
    }

    const games = await searchGamesForUser({
      userId: user.id,
      limit: SEARCH_MATCH_HISTORY_LIMIT,
      offset,
    })
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
      hasMoreGames: games.length >= SEARCH_MATCH_HISTORY_LIMIT,
    }
  }

  @httpGet('/:id/ranking-history')
  @httpBefore(
    throttleMiddleware(rankingsHistoryRetrievalThrottle, ctx =>
      String(ctx.session?.user?.id ?? ctx.ip),
    ),
  )
  async getUserRankingHistory(ctx: RouterContext): Promise<GetUserRankingHistoryResponse> {
    const { params } = validateRequest(ctx, {
      params: Joi.object<{ id: SbUserId }>({
        id: joiUserId().required(),
      }),
    })

    const user = await findUserById(params.id)
    if (!user) {
      throw new UserApiError(UserErrorCode.NotFound, 'user not found')
    }

    const ranks = await getMatchmakingFinalizedRanksForUser(params.id)
    const seasons = await getMatchmakingSeasonsByIds(ranks.map(r => r.seasonId))

    const history: LadderPlayer[] = ranks.map(
      r =>
        ({
          userId: r.userId,
          matchmakingType: r.matchmakingType,
          seasonId: r.seasonId,
          rank: r.rank,
          rating: r.rating,
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
        }) satisfies LadderPlayer,
    )

    return {
      history,
      seasons: seasons.map(s => toMatchmakingSeasonJson(s)),
    }
  }

  @httpGet('/batch-info')
  @httpBefore(
    ensureLoggedIn,
    throttleMiddleware(accountRetrievalThrottle, ctx => String(ctx.session!.user!.id)),
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

  @httpPost('/:id/policies')
  @httpBefore(
    ensureLoggedIn,
    throttleMiddleware(accountUpdateThrottle, ctx => String(ctx.session!.user!.id)),
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

    if (params.id !== ctx.session!.user!.id) {
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

    const { user } = await this.userService.updateCurrentUser(params.id, updates, ctx)

    return { user }
  }

  @httpPost('/:id/language')
  @httpBefore(ensureLoggedIn)
  async changeLanguage(ctx: RouterContext): Promise<ChangeLanguagesResponse> {
    const { params, body } = validateRequest(ctx, {
      params: Joi.object<{ id: SbUserId }>({
        id: joiUserId().required(),
      }),
      body: Joi.object<ChangeLanguageRequest>({
        language: Joi.valid(...ALL_TRANSLATION_LANGUAGES).required(),
      }),
    })

    if (params.id !== ctx.session!.user!.id) {
      throw new httpErrors.Unauthorized("Can't change another user's language")
    }

    const { user } = await this.userService.updateCurrentUser(
      params.id,
      { locale: body.language },
      ctx,
    )

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

      await this.userService.updateCurrentUser(user.id, { password: await hashPass(password) })
    })

    ctx.status = 204
  }

  @httpPost('/:id/email-verification/send')
  @httpBefore(
    ensureLoggedIn,
    throttleMiddleware(sendVerificationThrottle, ctx => String(ctx.session!.user!.id)),
  )
  async resendVerificationEmail(ctx: RouterContext): Promise<void> {
    const { params } = validateRequest(ctx, {
      params: Joi.object<{ id: SbUserId }>({
        id: joiUserId().valid(ctx.session!.user!.id).required(),
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
    throttleMiddleware(emailVerificationThrottle, ctx => String(ctx.session!.user!.id)),
  )
  async verifyEmail(ctx: RouterContext): Promise<void> {
    const {
      params,
      body: { code },
    } = validateRequest(ctx, {
      params: Joi.object<{ id: SbUserId }>({
        id: joiUserId().valid(ctx.session!.user!.id).required(),
      }),
      body: Joi.object<{ code: string }>({
        code: Joi.string().required(),
      }),
    })

    const user = await findSelfById(params.id)
    if (!user) {
      throw new UserApiError(UserErrorCode.NotFound, 'user not found')
    }

    const emailVerified = await this.userService.verifyEmail({
      id: user.id,
      email: user.email,
      code,
    })
    if (!emailVerified) {
      throw new UserApiError(UserErrorCode.InvalidCode, 'invalid code')
    }

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
    throttleMiddleware(accountRetrievalThrottle, ctx => String(ctx.session!.user!.id)),
  )
  async getRelationships(ctx: RouterContext): Promise<GetRelationshipsResponse> {
    const { params } = validateRequest(ctx, {
      params: Joi.object<{ id: SbUserId }>({
        id: joiUserId().valid(ctx.session!.user!.id).required(),
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
    throttleMiddleware(relationshipsThrottle, ctx => String(ctx.session!.user!.id)),
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
      ctx.session!.user!.id,
      user.id,
    )

    return { relationship: toUserRelationshipJson(relationship), user }
  }

  @httpDelete('/:toId/relationships/friend-requests/:fromId')
  @httpBefore(
    ensureLoggedIn,
    throttleMiddleware(relationshipsThrottle, ctx => String(ctx.session!.user!.id)),
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

    if (toId !== ctx.session!.user!.id && fromId !== ctx.session!.user!.id) {
      throw new httpErrors.BadRequest('Can only manage your own friend requests')
    }
    const otherUser = toId === ctx.session!.user!.id ? fromId : toId

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
    throttleMiddleware(relationshipsThrottle, ctx => String(ctx.session!.user!.id)),
  )
  async acceptFriendRequest(ctx: RouterContext): Promise<ModifyRelationshipResponse> {
    const {
      params: { toId, fromId },
    } = validateRequest(ctx, {
      params: Joi.object<{ toId: SbUserId; fromId: SbUserId }>({
        toId: joiUserId().valid(ctx.session!.user!.id).required(),
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
    throttleMiddleware(relationshipsThrottle, ctx => String(ctx.session!.user!.id)),
  )
  async removeFriend(ctx: RouterContext): Promise<void> {
    const {
      params: { removerId, targetId },
    } = validateRequest(ctx, {
      params: Joi.object<{ removerId: SbUserId; targetId: SbUserId }>({
        removerId: joiUserId().valid(ctx.session!.user!.id).required(),
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
    throttleMiddleware(relationshipsThrottle, ctx => String(ctx.session!.user!.id)),
  )
  async blockUser(ctx: RouterContext): Promise<ModifyRelationshipResponse> {
    const {
      params: { blockerId, targetId },
    } = validateRequest(ctx, {
      params: Joi.object<{ blockerId: SbUserId; targetId: SbUserId }>({
        blockerId: joiUserId().valid(ctx.session!.user!.id).required(),
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
    throttleMiddleware(relationshipsThrottle, ctx => String(ctx.session!.user!.id)),
  )
  async unblockUser(ctx: RouterContext): Promise<void> {
    const {
      params: { unblockerId, targetId },
    } = validateRequest(ctx, {
      params: Joi.object<{ unblockerId: SbUserId; targetId: SbUserId }>({
        unblockerId: joiUserId().valid(ctx.session!.user!.id).required(),
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
  constructor(
    private banEnacter: BanEnacter,
    private userService: UserService,
  ) {}

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

    if (params.id === ctx.session!.user!.id) {
      throw new UserApiError(UserErrorCode.NotAllowedOnSelf, "can't ban yourself")
    }

    const user = await findUserById(params.id)
    if (!user) {
      throw new UserApiError(UserErrorCode.NotFound, 'user not found')
    }

    const [ban, bannedBy] = await Promise.all([
      this.banEnacter.enactBan({
        targetId: user.id,
        bannedBy: ctx.session!.user!.id,
        banLengthHours: body.banLengthHours,
        reason: body.reason,
      }),
      await findUserById(ctx.session!.user!.id),
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

    // TODO(tec27): Admins probably want more info than just this, maybe we should merge some of
    // this functionality with the profile page
    const user = await findUserByName(searchTerm)
    return user ? [user] : []
  }
}
