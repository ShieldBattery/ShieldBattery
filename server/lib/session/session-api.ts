import { RouterContext } from '@koa/router'
import Joi from 'joi'
import { ReadonlyDeep } from 'type-fest'
import { assertUnreachable } from '../../../common/assert-unreachable'
import {
  PASSWORD_MINLENGTH,
  USERNAME_MAXLENGTH,
  USERNAME_MINLENGTH,
  USERNAME_PATTERN,
} from '../../../common/constants'
import { SelfUser, UserErrorCode } from '../../../common/users/sb-user'
import { ClientSessionInfo } from '../../../common/users/session'
import { makeErrorConverterMiddleware } from '../errors/coded-error'
import { asHttpError } from '../errors/error-with-payload'
import { httpApi, httpBeforeAll } from '../http/http-api'
import { httpBefore, httpDelete, httpGet, httpPost } from '../http/route-decorators'
import { joiLocale } from '../i18n/locale-validator'
import createThrottle from '../throttle/create-throttle'
import throttleMiddleware from '../throttle/middleware'
import { Clock } from '../time/clock'
import { isUserBanned, retrieveBanHistory } from '../users/ban-models'
import { joiClientIdentifiers } from '../users/client-ids'
import { UserApiError, convertUserApiErrors } from '../users/user-api-errors'
import { UserIdentifierManager } from '../users/user-identifier-manager'
import { attemptLogin, findSelfById, maybeMigrateSignupIp } from '../users/user-model'
import { UserService } from '../users/user-service'
import { validateRequest } from '../validation/joi-validator'
import { SessionError, SessionErrorCode, getJwt } from './jwt-session-middleware'

// TODO(tec27): Think about maybe a different mechanism for this. I could see this causing problems
// when lots of people need to create sessions at once from the same place (e.g. LAN events)
const loginThrottle = createThrottle('login', {
  rate: 4,
  burst: 20,
  window: 60000,
})

interface LogInRequestBody {
  username: string
  password: string
  remember?: boolean
  clientIds?: ReadonlyArray<[type: number, hashStr: string]>
  locale?: string
}

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
  constructor(
    private userIdentifierManager: UserIdentifierManager,
    private userService: UserService,
    private clock: Clock,
  ) {}

  @httpGet('/')
  async getCurrentSession(ctx: RouterContext): Promise<ReadonlyDeep<ClientSessionInfo>> {
    const {
      query: { locale },
    } = validateRequest(ctx, {
      query: Joi.object<{ date: number; locale?: string }>({
        date: Joi.number().required(),
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

    return { ...ctx.session, jwt: await getJwt(ctx, this.clock.now()) }
  }

  @httpPost('/')
  @httpBefore(throttleMiddleware(loginThrottle, ctx => ctx.ip))
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
        clientIds: joiClientIdentifiers().required(),
        locale: joiLocale(),
      }),
    })

    const { username, password, remember, clientIds, locale } = body

    if (ctx.session) {
      await ctx.deleteSession()
    }

    let user = await attemptLogin(username, password)

    if (!user) {
      throw new UserApiError(UserErrorCode.InvalidCredentials, 'Incorrect username or password')
    }

    if (clientIds) {
      await this.userIdentifierManager.upsert(user.id, clientIds)
    }

    if (await isUserBanned(user.id)) {
      const banHistory = await retrieveBanHistory(user.id, 1)
      const banEntry = banHistory.length ? banHistory[0] : undefined
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
      throw new UserApiError(UserErrorCode.AccountBanned, 'This account has been banned', {
        data: {
          reason: banEntry?.reason,
          expiration: Number(banEntry?.endTime),
        },
      })
    }

    await ctx.beginSession(user.id, !!remember)
    user = ctx.session!.user
    await maybeMigrateSignupIp(user.id, ctx.ip)

    if (locale && !user.locale) {
      await this.userService.updateCurrentUser(user.id, { locale }, ctx)
    }

    return { ...ctx.session!, jwt: await getJwt(ctx, this.clock.now()) }
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
