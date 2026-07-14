import Koa, { AppSession } from 'koa'
import { delay, inject, singleton } from 'tsyringe'
import { SbPermissions } from '../../../common/users/permissions'
import { fromSelfUserJson, SelfUser, toSelfUserJson } from '../../../common/users/sb-user'
import { SbUserId } from '../../../common/users/sb-user-id'
import { AuthEvent } from '../../../common/users/user-network'
import { deleteFile, writeFile } from '../files'
import logger from '../logging/logger'
import { getPermissions } from '../models/permissions'
import { Redis, RedisSubscriber } from '../redis/redis'
import { TypedPublisher } from '../websockets/typed-publisher'
import { consumeEmailVerificationCode } from './email-verification-models'
import { findSelfById, setUserAvatarPath, updateUser, UserUpdatables } from './user-model'

/**
 * How long to cache user info in redis.
 *
 * This should always match the timeout in server-rs's code.
 */
const USER_CACHE_TIME_SECONDS = 60 * 60 // 1 hour

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
              userId: message.data.userId,
              permissions: message.data.permissions,
            })
            break
          case 'emailChanged':
            this.publisher.publish(`/userProfiles/${message.data.userId}`, {
              action: 'emailChanged',
              userId: message.data.userId,
              email: message.data.email,
            })
            break
          default:
            message satisfies never
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
        const cached = JSON.parse(cachedStr)
        return { user: fromSelfUserJson(cached.user), permissions: cached.permissions }
      }
    }

    const [user, permissions] = await Promise.all([findSelfById(userId), getPermissions(userId)])
    if (!user || !permissions) {
      throw new Error('failed to find user or permissions for id ' + userId)
    }

    // NOTE(tec27): The Rust side expects SbPermissions to contain this user ID field, so we add it
    // here so it can deserialize things properly.
    const result = { user, permissions: { id: user.id, ...permissions } }
    const json = JSON.stringify({ user: toSelfUserJson(user), permissions: result.permissions })
    await this.redis.setex(userDataKey(userId), USER_CACHE_TIME_SECONDS, json)

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
   * Sets (or clears, when `avatar` is `undefined`) a user's avatar, returning the updated user info
   * along with the previously-stored path (so the caller can delete the orphaned file). Works for
   * any user ID, not just the current user (e.g. admin moderation removing another user's avatar).
   * Refreshes the cached user data and, if `ctx` is provided and its session belongs to the
   * affected user, the current session.
   *
   * When setting an avatar, the file is written to the store *before* the DB is updated so the DB
   * never references a file that doesn't exist; if the DB update then fails, the just-written file
   * is cleaned up.
   */
  async updateUserAvatar(
    id: SbUserId,
    avatar: { path: string; data: Buffer; contentType?: string } | undefined,
    ctx?: Koa.Context,
  ): Promise<{ userInfo: SelfUserInfo; previousPath?: string }> {
    let previousPath: string | undefined
    if (avatar) {
      await writeFile(avatar.path, avatar.data, { acl: 'public-read', type: avatar.contentType })
      try {
        ;({ previousPath } = await setUserAvatarPath(id, avatar.path))
      } catch (err) {
        // The file was written but the DB update failed, so it's now orphaned. Best-effort cleanup;
        // the original error is what matters to the caller.
        deleteFile(avatar.path).catch(deleteErr =>
          logger.error({ err: deleteErr }, 'error deleting orphaned avatar file'),
        )
        throw err
      }
    } else {
      ;({ previousPath } = await setUserAvatarPath(id, undefined))
    }

    const selfInfo = await this.getSelfUserInfo(id, CacheBehavior.ForceRefresh)

    if (ctx && ctx.session?.user.id === id) {
      ;(ctx.session as any as AppSession) = selfInfo
    }

    return { userInfo: selfInfo, previousPath }
  }

  /**
   * Attempts to verify the current user's email, returning whether their email was verified. Will
   * update the cached user data.
   */
  async verifyEmail({ userId, code }: { userId: SbUserId; code: string }): Promise<boolean> {
    const verified = await consumeEmailVerificationCode({
      userId,
      code,
    })

    if (verified) {
      await this.getSelfUserInfo(userId, CacheBehavior.ForceRefresh)
    }

    return verified
  }
}
