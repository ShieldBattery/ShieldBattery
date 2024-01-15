import Koa, { AppSession } from 'koa'
import { delay, inject, singleton } from 'tsyringe'
import { SbPermissions } from '../../../common/users/permissions'
import { AuthEvent, SbUserId, SelfUser, makeSbUserId } from '../../../common/users/sb-user'
import logger from '../logging/logger'
import { getPermissions } from '../models/permissions'
import { Redis, RedisSubscriber } from '../redis/redis'
import { TypedPublisher } from '../websockets/typed-publisher'
import { consumeEmailVerificationCode } from './email-verification-models'
import { UserUpdatables, findSelfById, updateUser } from './user-model'

/** How long to cache user info in redis. */
const USER_CACHE_TIME_SECONDS = 60 * 60 * 1000 // 1 hour

function userDataKey(userId: SbUserId) {
  return `users:${userId}`
}

export interface SelfUserInfo {
  user: SelfUser
  permissions: SbPermissions
}

export enum CacheBehavior {
  AllowCached,
  ForceRefresh,
}

@singleton()
export class UserService {
  constructor(
    private redis: Redis,
    private redisSubscriber: RedisSubscriber,
    // NOTE(tec27): This service is used by the JWT middleware, which also needs to be used by the
    // websockets, so we use a lazy injection to break the dependency cycle
    @inject(delay(() => TypedPublisher<AuthEvent>)) private publisher: TypedPublisher<AuthEvent>,
  ) {
    this.redisSubscriber
      .subscribe('user', message => {
        switch (message.type) {
          case 'permissionsChanged':
            this.publisher.publish(`/userProfiles/${message.data.userId}`, {
              action: 'permissionsChanged',
              userId: makeSbUserId(message.data.userId),
              permissions: message.data.permissions,
            })
            break
        }
      })
      .catch(err => {
        logger.error({ err }, 'failed to subscribe to Redis user messages')
      })
  }

  /**
   * Retrieves info about the current user (specified by ID), optionally forcing the request to
   * bypass cached data. If the user is not found in the cache or the cache is bypassed, the cache
   * will be updated to the latest data.
   */
  async getSelfUserInfo(
    userId: SbUserId,
    cacheBehavior = CacheBehavior.AllowCached,
  ): Promise<SelfUserInfo> {
    if (cacheBehavior === CacheBehavior.AllowCached) {
      const cachedStr = await this.redis.get(userDataKey(userId))
      if (cachedStr) {
        return JSON.parse(cachedStr)
      }
    }

    const [user, permissions] = await Promise.all([findSelfById(userId), getPermissions(userId)])
    if (!user || !permissions) {
      throw new Error('failed to find user or permissions for id ' + userId)
    }

    // NOTE(tec27): The Rust side expects SbPermissions to contain this user ID field, so we add it
    // here so it can deserialize things properly.
    const result = { user, permissions: { id: user.id, ...permissions } }
    await this.redis.setex(userDataKey(userId), USER_CACHE_TIME_SECONDS, JSON.stringify(result))

    return result
  }

  /**
   * Applies updates to the current user, returning the updated user. Will update the cached user
   * data.
   *
   * If `ctx` is provided, the current session data will be updated as well.
   */
  async updateCurrentUser(
    id: SbUserId,
    updates: Partial<UserUpdatables>,
    ctx?: Koa.Context,
  ): Promise<SelfUserInfo> {
    await updateUser(id, updates)
    const selfInfo = await this.getSelfUserInfo(id, CacheBehavior.ForceRefresh)

    if (ctx && ctx.session?.user.id === id) {
      ;(ctx.session as any as AppSession) = selfInfo
    }

    return selfInfo
  }

  /**
   * Attempts to verify the current user's email, returning whether their email was verified. Will
   * update the cached user data.
   */
  async verifyEmail({
    id,
    email,
    code,
  }: {
    id: SbUserId
    email: string
    code: string
  }): Promise<boolean> {
    const verified = await consumeEmailVerificationCode({
      id,
      email,
      code,
    })

    if (verified) {
      await this.getSelfUserInfo(id, CacheBehavior.ForceRefresh)
    }

    return verified
  }
}
