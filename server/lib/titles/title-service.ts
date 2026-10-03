import Koa, { AppSession } from 'koa'
import { singleton } from 'tsyringe'
import { NotificationType } from '../../../common/notifications'
import {
  DEFAULT_TITLE_ID,
  getEarnedTitleIds,
  GetSelfTitlesResponse,
  getTitleDefinition,
  isGrantedTitle,
  TitleId,
  TitleTrack,
  UnlockedTitleJson,
} from '../../../common/titles'
import { SbUser } from '../../../common/users/sb-user'
import { SbUserId } from '../../../common/users/sb-user-id'
import { AuthEvent } from '../../../common/users/user-network'
import { withDbClient } from '../db'
import transact from '../db/transaction'
import { CodedError } from '../errors/coded-error'
import { GameLifecycleEvents } from '../games/game-lifecycle-events'
import logger from '../logging/logger'
import { MatchmakingSeasonsService } from '../matchmaking/matchmaking-seasons'
import NotificationService from '../notifications/notification-service'
import { findUserById } from '../users/user-model'
import { CacheBehavior, UserService } from '../users/user-service'
import { UserSocketsManager } from '../websockets/socket-groups'
import { TypedPublisher } from '../websockets/typed-publisher'
import {
  getGamePlayerIds,
  getTitleMetrics,
  getUserTitles,
  grantTitle,
  insertEarnedTitles,
  revokeTitle,
  setEquippedTitle,
  UserTitle,
} from './title-models'

export enum TitleServiceErrorCode {
  NotFound = 'notFound',
  NotUnlocked = 'notUnlocked',
  NotGrantable = 'notGrantable',
}

export class TitleServiceError extends CodedError<TitleServiceErrorCode> {}

function toUnlockedJson(title: UserTitle): UnlockedTitleJson {
  return { id: title.id, unlockedAt: Number(title.unlockedAt) }
}

/**
 * Awards titles as players earn them, and manages which title each player displays.
 *
 * Earned titles are checked against a player's whole history whenever it changes (a game's results
 * are applied) and whenever they come online, and every newly met title is written to `user_titles`
 * once. Checking the whole history each time keeps the check idempotent: an event that's delivered
 * twice, or missed entirely, is caught by the next one. A player's first check records the titles
 * their existing history already earned without notifying for each, sending a single summary
 * notification instead.
 */
@singleton()
export class TitleService {
  /**
   * The most recent evaluation for each user that has one in flight. Evaluations for the same user
   * are chained so concurrent triggers (e.g. a game ending as the player reconnects) don't race to
   * notify about the same titles.
   */
  private evaluations = new Map<SbUserId, Promise<void>>()

  constructor(
    private gameLifecycleEvents: GameLifecycleEvents,
    private userSocketsManager: UserSocketsManager,
    private notificationService: NotificationService,
    private matchmakingSeasonsService: MatchmakingSeasonsService,
    private userService: UserService,
    private publisher: TypedPublisher<AuthEvent>,
  ) {
    this.gameLifecycleEvents.on('gameResultsApplied', ({ gameId }) => {
      this.evaluateGamePlayers(gameId).catch(err => {
        logger.error({ err, gameId }, 'error evaluating titles for the players of a game')
      })
    })
    this.userSocketsManager.on('newUser', userSockets => {
      this.evaluateUser(userSockets.userId).catch(err => {
        logger.error({ err, userId: userSockets.userId }, 'error evaluating titles for a user')
      })
    })
  }

  private async evaluateGamePlayers(gameId: string): Promise<void> {
    const playerIds = await withDbClient(client => getGamePlayerIds(client, gameId))
    // One at a time, so a large game doesn't hold several pool connections at once.
    for (const userId of playerIds) {
      await this.evaluateUser(userId)
    }
  }

  /**
   * Awards any earned titles the user doesn't hold yet and notifies them about the new ones.
   */
  evaluateUser(userId: SbUserId): Promise<void> {
    const previous = this.evaluations.get(userId) ?? Promise.resolve()
    const next = previous
      .catch(() => {})
      .then(() => this.doEvaluateUser(userId))
      .finally(() => {
        if (this.evaluations.get(userId) === next) {
          this.evaluations.delete(userId)
        }
      })
    this.evaluations.set(userId, next)
    return next
  }

  private async doEvaluateUser(userId: SbUserId): Promise<void> {
    const seasons = await this.matchmakingSeasonsService.getAllSeasons()
    const newTitles = await withDbClient(async client => {
      const metrics = await getTitleMetrics(client, userId, seasons)
      return await insertEarnedTitles(client, userId, getEarnedTitleIds(metrics))
    })
    if (!newTitles.length) {
      return
    }

    // The default title is only ever newly recorded on a user's first evaluation, since it's always
    // earned. Everything recorded alongside it came from their existing history.
    if (newTitles.includes(DEFAULT_TITLE_ID)) {
      // A brand new player has nothing to be told about yet; their first unlock will notify them.
      if (newTitles.length > 1) {
        await this.notificationService.addNotification({
          userId,
          data: { type: NotificationType.TitlesIntroduced, count: newTitles.length - 1 },
        })
      }
    } else {
      await this.notificationService.addNotification({
        userId,
        data: { type: NotificationType.TitleUnlocked, titleIds: newTitles },
      })
    }
  }

  async getSelfTitles(userId: SbUserId): Promise<GetSelfTitlesResponse> {
    // Make sure the response reflects everything the user has earned, even if the evaluation from
    // their last game is still pending.
    await this.evaluateUser(userId)

    const seasons = await this.matchmakingSeasonsService.getAllSeasons()
    return await withDbClient(async client => {
      const [titles, metrics] = await Promise.all([
        getUserTitles(client, userId),
        getTitleMetrics(client, userId, seasons),
      ])
      return {
        unlocked: titles.map(toUnlockedJson),
        equipped: titles.find(t => t.equipped)?.id,
        metrics,
      }
    })
  }

  async getUserTitles(userId: SbUserId): Promise<UnlockedTitleJson[]> {
    const titles = await withDbClient(client => getUserTitles(client, userId))
    return titles.map(toUnlockedJson)
  }

  /**
   * Sets the title a user displays. Equipping the default title clears their equipped title.
   *
   * @returns the user's updated info
   */
  async equipTitle(userId: SbUserId, titleId: TitleId, ctx?: Koa.Context): Promise<SbUser> {
    const equipped = await transact(client =>
      setEquippedTitle(client, userId, titleId === DEFAULT_TITLE_ID ? undefined : titleId),
    )
    if (!equipped) {
      throw new TitleServiceError(
        TitleServiceErrorCode.NotUnlocked,
        "that title hasn't been unlocked",
      )
    }

    return await this.onTitleChanged(userId, ctx)
  }

  /**
   * Grants a title an admin hands out by hand. Staff titles are also equipped, since they're how
   * staff are identified.
   */
  async grantTitle(
    userId: SbUserId,
    titleId: TitleId,
    grantedBy: SbUserId,
    ctx?: Koa.Context,
  ): Promise<UnlockedTitleJson[]> {
    if (!isGrantedTitle(titleId)) {
      throw new TitleServiceError(TitleServiceErrorCode.NotGrantable, "that title can't be granted")
    }
    if (!(await findUserById(userId))) {
      throw new TitleServiceError(TitleServiceErrorCode.NotFound, 'user not found')
    }

    const isStaff = getTitleDefinition(titleId).track === TitleTrack.Staff
    const granted = await transact(async client => {
      const granted = await grantTitle(client, userId, titleId, grantedBy)
      if (granted && isStaff) {
        await setEquippedTitle(client, userId, titleId)
      }
      return granted
    })

    if (granted) {
      if (isStaff) {
        await this.onTitleChanged(userId, ctx)
      }
      await this.notificationService.addNotification({
        userId,
        data: { type: NotificationType.TitleUnlocked, titleIds: [titleId] },
      })
    }

    return await this.getUserTitles(userId)
  }

  /** Removes a title an admin handed out. If the user displayed it, they revert to the default. */
  async revokeTitle(
    userId: SbUserId,
    titleId: TitleId,
    ctx?: Koa.Context,
  ): Promise<UnlockedTitleJson[]> {
    if (!isGrantedTitle(titleId)) {
      throw new TitleServiceError(
        TitleServiceErrorCode.NotGrantable,
        "earned titles can't be revoked",
      )
    }

    const { wasEquipped } = await withDbClient(client => revokeTitle(client, userId, titleId))
    if (wasEquipped) {
      await this.onTitleChanged(userId, ctx)
    }

    return await this.getUserTitles(userId)
  }

  /**
   * Refreshes everything that holds a copy of a user's info after their displayed title changes:
   * the shared user cache, the acting session (if it's theirs), and their connected clients.
   */
  private async onTitleChanged(userId: SbUserId, ctx?: Koa.Context): Promise<SbUser> {
    const selfInfo = await this.userService.getSelfUserInfo(userId, CacheBehavior.ForceRefresh)
    if (ctx && ctx.session?.user.id === userId) {
      ;(ctx.session as any as AppSession) = selfInfo
    }

    const { user } = selfInfo
    const sbUser: SbUser = {
      id: user.id,
      name: user.name,
      created: user.created,
      avatarUrl: user.avatarUrl,
      staffBadge: user.staffBadge,
      title: user.title,
    }
    this.publisher.publish(`/userProfiles/${userId}`, {
      action: 'titleChanged',
      userId,
      user: sbUser,
    })
    return sbUser
  }
}
