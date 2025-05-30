import jwt from 'jsonwebtoken'
import Koa, { AppSession } from 'koa'
import { container } from 'tsyringe'
import uid from 'uid-safe'
import { promisify } from 'util'
import { SbUserId } from '../../../common/users/sb-user-id'
import { CodedError } from '../errors/coded-error'
import { Redis } from '../redis/redis'
import { Clock } from '../time/clock'
import { CacheBehavior, UserService } from '../users/user-service'
import { DeletedSessionRegistry } from './deleted-sessions'

const SESSION_TTL_SECONDS = Number(process.env.SB_SESSION_TTL)
const JWT_SECRET = process.env.SB_JWT_SECRET!

function sessionKey(userId: SbUserId, sessionId: string) {
  return `sessions:${userId}:${sessionId}`
}

const jwtSign = promisify(jwt.sign) as any as (
  payload: unknown,
  secret: jwt.Secret,
  options: jwt.SignOptions,
) => Promise<string>

interface JwtPayloadData {
  sessionId: string
  userId: SbUserId
  /** The last time the user explicitly authenticated (as a JS unix timestamp in UTC) */
  authTime: number
  /**
   * Whether the user wants to stay logged in, or have the session expire when the browser exits.
   */
  stayLoggedIn: boolean
}

export interface StateWithJwt {
  jwtData?: {
    /** When this token was issued (as a unix timestamp). */
    iat: number
    /** When this token expires (as a unix timestamp). */
    exp: number
  } & JwtPayloadData
}

export enum SessionErrorCode {
  /** Attempted to create a new session when one already exists. */
  AlreadyHaveSession = 'alreadyHaveSession',
}

export class SessionError extends CodedError<SessionErrorCode> {}

export function jwtSessions(): Koa.Middleware<StateWithJwt> {
  const redis = container.resolve(Redis)
  const clock = container.resolve(Clock)
  const userService = container.resolve(UserService)
  const deletedSessions = container.resolve(DeletedSessionRegistry)

  return async (ctx, next) => {
    ctx.beginSession = async (userId: SbUserId, stayLoggedIn: boolean) => {
      if (ctx.session) {
        throw new SessionError(
          SessionErrorCode.AlreadyHaveSession,
          'tried to start a new session with an existing session',
        )
      }
      const now = clock.now()

      ;(ctx.session as any as AppSession) = await userService.getSelfUserInfo(
        userId,
        CacheBehavior.ForceRefresh,
      )

      const sessionId = await uid(24)
      const sessionData: JwtPayloadData = {
        sessionId,
        userId,
        authTime: now,
        stayLoggedIn,
      }

      await redis.setex(
        sessionKey(userId, sessionData.sessionId),
        SESSION_TTL_SECONDS,
        JSON.stringify(sessionData),
      )

      ctx.state.jwtData = {
        iat: Math.floor(now / 1000),
        exp: Math.floor(now / 1000) + SESSION_TTL_SECONDS,
        ...sessionData,
      }
    }

    ctx.deleteSession = async () => {
      if (ctx.state.jwtData) {
        const key = sessionKey(ctx.state.jwtData.userId, ctx.state.jwtData.sessionId)

        if (deletedSessions.register(key)) {
          await redis.del(key)
        }
      }

      ctx.state.jwtData = undefined
      ;(ctx.session as any) = undefined
    }

    if (ctx.state.jwtData) {
      // Make sure the session still exists
      const sessionExists =
        (await redis.exists(sessionKey(ctx.state.jwtData.userId, ctx.state.jwtData.sessionId))) > 0

      if (sessionExists) {
        try {
          ;(ctx.session as any as AppSession) = await userService.getSelfUserInfo(
            ctx.state.jwtData.userId,
          )
        } catch (err) {
          ctx.log.error({ err }, 'error loading user/permissions for session')
        }
      }
    }

    if (!ctx.session) {
      // If the session isn't set at this point, then it either doesn't exist or something went
      // wrong loading the user data, so we just clear this session out
      ctx.state.jwtData = undefined
    }

    try {
      await next()
    } finally {
      if (ctx.state.jwtData) {
        const { jwtData } = ctx.state

        try {
          await redis.expire(sessionKey(jwtData.userId, jwtData.sessionId), SESSION_TTL_SECONDS)
        } catch (err) {
          ctx.log.error({ err }, 'error setting session new expiration')
        }
      }
    }
  }
}

/** Generates a JWT for the current session. Will throw if no session is active. */
export async function getJwt(ctx: Koa.Context, now = Date.now()): Promise<string> {
  const { jwtData } = ctx.state
  if (!jwtData) {
    throw new Error('No active session available for generating JWT')
  }

  return await jwtSign(
    {
      ...jwtData,
      iat: Math.floor(now / 1000),
      exp: Math.floor(now / 1000) + SESSION_TTL_SECONDS,
    },
    JWT_SECRET,
    {
      algorithm: 'HS256',
    },
  )
}
