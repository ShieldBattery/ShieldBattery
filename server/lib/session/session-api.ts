import { RouterContext } from '@koa/router'
import { Counter } from '@prometheus-io/client'
import httpErrors from 'http-errors'
import Joi from 'joi'
import { ReadonlyDeep } from 'type-fest'
import { assertUnreachable } from '../../../common/assert-unreachable'
import {
  PASSWORD_MINLENGTH,
  USERNAME_MAXLENGTH,
  USERNAME_MINLENGTH,
  USERNAME_PATTERN,
} from '../../../common/constants'
import {
  ClientAttestationRequest,
  ClientProof,
  LoginChallengeRequest,
  LoginChallengeResponse,
} from '../../../common/users/client-proof'
import { SelfUser, toSelfUserJson } from '../../../common/users/sb-user'
import { ClientSessionInfo, SessionClientClass } from '../../../common/users/session'
import { UserErrorCode } from '../../../common/users/user-network'
import { makeErrorConverterMiddleware } from '../errors/coded-error'
import { asHttpError } from '../errors/error-with-payload'
import { httpApi, httpBeforeAll } from '../http/http-api'
import { httpBefore, httpDelete, httpGet, httpPost } from '../http/route-decorators'
import { joiLocale } from '../i18n/locale-validator'
import { isElectronClient } from '../network/electron-clients'
import createThrottle from '../throttle/create-throttle'
import throttleMiddleware, { throttleByIp } from '../throttle/middleware'
import { Clock } from '../time/clock'
import { isUserBanned, retrieveBanHistory } from '../users/ban-models'
import { clientAttestationFailed, isClientAttestationFailure } from '../users/client-attestation'
import { ClientIdentifierString, joiClientIdentifiers } from '../users/client-ids'
import { authorizeDevelopmentClients } from '../users/development-clients'
import { LoginAttestationService } from '../users/login-attestation-service'
import { convertUserApiErrors, UserApiError } from '../users/user-api-errors'
import { UserIdentifierManager } from '../users/user-identifier-manager'
import { attemptLogin, findSelfById, maybeMigrateSignupIp } from '../users/user-model'
import { UserService } from '../users/user-service'
import { validateRequest } from '../validation/joi-validator'
import { SocketAdmission } from '../websockets/socket-admission'
import ensureLoggedIn from './ensure-logged-in'
import { getJwt, SessionError, SessionErrorCode } from './jwt-session-middleware'

// TODO(tec27): Think about maybe a different mechanism for this. I could see this causing problems
// when lots of people need to create sessions at once from the same place (e.g. LAN events)
const loginThrottle = createThrottle('login', {
  rate: 4,
  burst: 20,
  window: 60000,
})
const loginChallengeThrottle = createThrottle('loginchallenge', {
  rate: 4,
  burst: 20,
  window: 60000,
})
const clientAttestationThrottle = createThrottle('clientattestation', {
  rate: 10,
  burst: 30,
  window: 60000,
})

interface LogInRequestBody {
  username: string
  password: string
  remember?: boolean
  clientIds: ReadonlyArray<[type: number, hashStr: string]>
  locale?: string
  attemptId?: string
  proof?: ClientProof
  developmentClient?: boolean
}

const joiClientProof = () =>
  Joi.object<ClientProof>({
    keyId: Joi.number().integer().min(0).max(0xffffffff).required(),
    body: Joi.string().max(360).required(),
    signature: Joi.string().max(88).required(),
  })

export const convertSessionErrors = makeErrorConverterMiddleware(err => {
  if (!(err instanceof SessionError)) {
    throw err
  }

  switch (err.code) {
    case SessionErrorCode.AlreadyHaveSession:
      throw asHttpError(409, err)

    default:
      assertUnreachable(err.code)
  }
})

@httpApi('/sessions')
@httpBeforeAll(convertUserApiErrors, convertSessionErrors)
export class SessionApi {
  private loginAttemptsTotalMetric = new Counter({
    name: 'shieldbattery_login_attempts_total',
    labelNames: ['outcome'],
    help: 'Total number of login attempts, by outcome',
  })

  constructor(
    private userIdentifierManager: UserIdentifierManager,
    private userService: UserService,
    private loginAttestation: LoginAttestationService,
    private socketAdmission: SocketAdmission,
    private clock: Clock,
  ) {}

  @httpGet('/')
  async getCurrentSession(ctx: RouterContext): Promise<ReadonlyDeep<ClientSessionInfo>> {
    const {
      query: { locale },
    } = validateRequest(ctx, {
      query: Joi.object<{ date: number; locale?: string }>({
        date: Joi.number(),
        locale: joiLocale(),
      }),
    })

    if (!ctx.session?.user) {
      throw new UserApiError(UserErrorCode.SessionExpired, 'Session expired')
    }
    const userId = ctx.session.user.id

    let user: SelfUser | undefined
    try {
      user = await findSelfById(userId)
    } catch (err) {
      ctx.log.error({ err }, 'error finding user')
      throw err
    }

    if (!user) {
      await ctx.deleteSession()
      throw new UserApiError(UserErrorCode.SessionExpired, 'Session expired')
    }

    if (locale && !user.locale) {
      await this.userService.updateCurrentUser(user.id, { locale }, ctx)
    }

    return {
      user: toSelfUserJson(ctx.session.user),
      permissions: ctx.session.permissions,
      jwt: await getJwt(ctx, this.clock.now()),
    }
  }

  @httpPost('/')
  @httpBefore(throttleMiddleware(loginThrottle, throttleByIp))
  async startNewSession(ctx: RouterContext): Promise<ReadonlyDeep<ClientSessionInfo>> {
    const { body } = validateRequest(ctx, {
      body: Joi.object<LogInRequestBody>({
        username: Joi.string()
          .min(USERNAME_MINLENGTH)
          .max(USERNAME_MAXLENGTH)
          .pattern(USERNAME_PATTERN)
          .required(),
        password: Joi.string().min(PASSWORD_MINLENGTH).required(),
        remember: Joi.boolean(),
        clientIds: joiClientIdentifiers(ctx).min(0).required(),
        locale: joiLocale(),
        attemptId: Joi.string().uuid(),
        proof: joiClientProof(),
        developmentClient: Joi.boolean(),
      }).required(),
    })

    const { username, password, remember, locale, attemptId, proof, developmentClient } = body
    const electron = isElectronClient(ctx)
    let clientClass: SessionClientClass = electron ? 'app' : 'web'
    if (developmentClient) {
      if (!electron) {
        throw new httpErrors.BadRequest('Development mode requires an app client')
      }
      clientClass = 'development'
    }

    if (ctx.session) {
      await ctx.deleteSession()
    }

    let verifiedIds: ClientIdentifierString[] | undefined
    if (clientClass === 'app') {
      try {
        verifiedIds = await this.loginAttestation.verify({ username, password }, attemptId, proof)
      } catch (err) {
        if (isClientAttestationFailure(err)) {
          this.loginAttemptsTotalMetric.labels('unverified_client').inc()
        }
        throw err
      }
    }
    if (electron && !verifiedIds && !body.clientIds.length) {
      throw new httpErrors.BadRequest('Client identifiers are required')
    }

    let user = await attemptLogin(username, password)

    if (!user) {
      this.loginAttemptsTotalMetric.labels('invalid_credentials').inc()
      throw new UserApiError(UserErrorCode.InvalidCredentials, 'Incorrect username or password')
    }

    if (clientClass === 'development') {
      try {
        await authorizeDevelopmentClients([user.id])
      } catch {
        this.loginAttemptsTotalMetric.labels('unverified_client').inc()
        clientAttestationFailed('invalid')
      }
    }

    if (electron) {
      await this.userIdentifierManager.upsert(user.id, verifiedIds ?? body.clientIds)
    }

    if (await isUserBanned(user.id)) {
      const banHistory = await retrieveBanHistory(user.id, 1)
      const banEntry = banHistory.length ? banHistory[0] : undefined
      this.loginAttemptsTotalMetric.labels('banned').inc()
      throw new UserApiError(UserErrorCode.AccountBanned, 'This account has been banned', {
        data: {
          reason: banEntry?.reason,
          expiration: Number(banEntry?.endTime),
        },
      })
    } else if (await this.userIdentifierManager.banUserIfNeeded(user.id)) {
      // NOTE(tec27): We make sure to do this check *after* checking the account ban only, otherwise
      // any banned user that attempts to logs in will be permanently banned.
      const banHistory = await retrieveBanHistory(user.id, 1)
      const banEntry = banHistory.length ? banHistory[0] : undefined
      this.loginAttemptsTotalMetric.labels('banned').inc()
      throw new UserApiError(UserErrorCode.AccountBanned, 'This account has been banned', {
        data: {
          reason: banEntry?.reason,
          expiration: Number(banEntry?.endTime),
        },
      })
    }

    await ctx.beginSession(user.id, !!remember, clientClass)
    this.loginAttemptsTotalMetric.labels('success').inc()
    user = ctx.session!.user
    await maybeMigrateSignupIp(user.id, ctx.ip)

    if (locale && !user.locale) {
      await this.userService.updateCurrentUser(user.id, { locale }, ctx)
    }

    return {
      user: toSelfUserJson(ctx.session!.user),
      permissions: ctx.session!.permissions,
      jwt: await getJwt(ctx, this.clock.now()),
    }
  }

  @httpPost('/challenge')
  @httpBefore(throttleMiddleware(loginChallengeThrottle, throttleByIp))
  async createLoginChallenge(ctx: RouterContext): Promise<LoginChallengeResponse> {
    const { body } = validateRequest(ctx, {
      body: Joi.object<LoginChallengeRequest>({
        username: Joi.string().max(USERNAME_MAXLENGTH).required(),
        password: Joi.string().required(),
      }).required(),
    })

    if (!isElectronClient(ctx)) {
      return {}
    }
    return await this.loginAttestation.challenge(body)
  }

  @httpPost('/client-attestation')
  @httpBefore(ensureLoggedIn, throttleMiddleware(clientAttestationThrottle, throttleByIp))
  async attestClient(ctx: RouterContext): Promise<void> {
    const { body } = validateRequest(ctx, {
      body: Joi.object<ClientAttestationRequest>({
        attemptId: Joi.string().uuid().required(),
        proof: joiClientProof(),
      }).required(),
    })

    this.socketAdmission.attest(ctx.session!.user.id, ctx.state.jwtData!.sessionId, body)
    ctx.status = 204
  }

  @httpDelete('/')
  async endSession(ctx: RouterContext): Promise<void> {
    if (!ctx.session) {
      throw new UserApiError(UserErrorCode.SessionExpired, 'Session expired')
    }

    await ctx.deleteSession()
    ctx.status = 204
  }
}
