import Koa, { AppSession } from 'koa'
import { singleton } from 'tsyringe'
import { NotificationType } from '../../../common/notifications'
import {
  DEFAULT_TITLE_ID,
  getEarnedTitleIds,
  getTitleDefinition,
  isGrantedTitle,
  TitleDivision,
  TitleId,
  TITLES,
  TitleTrack,
} from '../../../common/titles'
import { GetSelfTitlesResponse, UnlockedTitleJson } from '../../../common/titles-network'
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
import { findUserById, setUserTitle } from '../users/user-model'
import { CacheBehavior, UserService } from '../users/user-service'
import { UserSocketsManager } from '../websockets/socket-groups'
import { TypedPublisher } from '../websockets/typed-publisher'
import {
  getGamePlayerIds,
  getPeakDivision,
  getRatingChangePoints,
  getTitleMetrics,
  getUserTitles,
  grantTitle,
  insertEarnedTitles,
  rebuildTitleCounters,
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
 * Returns the highest division a user has reached, as recorded by the division titles they hold.
 * Division titles are permanent, so they're a record of the user's peak that never has to be
 * recomputed from their rating history.
 */
function getHeldPeakDivision(held: ReadonlySet<TitleId>): TitleDivision | undefined {
  let peak: TitleDivision | undefined
  for (const title of TITLES) {
    if (title.criterion.kind === 'division' && held.has(title.id)) {
      peak = maxDivision(peak, title.criterion.division)
    }
  }
  return peak
}

function maxDivision(
  a: TitleDivision | undefined,
  b: TitleDivision | undefined,
): TitleDivision | undefined {
  return a === undefined || (b !== undefined && b > a) ? b : a
}

/**
 * Awards titles as players earn them, and manages which title each player displays.
 *
 * Earned titles are checked against running counts of a player's play (kept current as each game's
 * results are applied) whenever a game of theirs finishes and whenever they come online, and every
 * newly met title is written to `user_titles` once. Checking the counts rather than only the game
 * that just finished keeps the check idempotent: an event that's delivered twice, or missed
 * entirely, is caught by the next one. Division titles are the exception, since a player's peak
 * division isn't counted anywhere: they're checked against the ranked game that just finished.
 *
 * A player's first check counts their play from their existing history, and records the titles it
 * already earned without notifying for each, sending a single summary notification instead.
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
      await this.evaluateUser(userId, gameId)
    }
  }

  /**
   * Awards any earned titles the user doesn't hold yet and notifies them about the new ones.
   *
   * @param gameId the game whose results prompted this, if any, which is checked for a new division
   */
  evaluateUser(userId: SbUserId, gameId?: string): Promise<void> {
    const previous = this.evaluations.get(userId) ?? Promise.resolve()
    const next = previous
      .catch(() => {})
      .then(() => this.doEvaluateUser(userId, gameId))
      .finally(() => {
        if (this.evaluations.get(userId) === next) {
          this.evaluations.delete(userId)
        }
      })
    this.evaluations.set(userId, next)
    return next
  }

  private async doEvaluateUser(userId: SbUserId, gameId?: string): Promise<void> {
    const newTitles = await transact(async client => {
      const held = new Set((await getUserTitles(client, userId)).map(t => t.id))
      let peakDivision = getHeldPeakDivision(held)
      // Every user holds the default title once they've been evaluated, so it's only missing before
      // the first evaluation, which is when their play needs to be counted from their history.
      if (!held.has(DEFAULT_TITLE_ID)) {
        const seasons = await this.matchmakingSeasonsService.getAllSeasons()
        peakDivision = maxDivision(
          peakDivision,
          await rebuildTitleCounters(client, userId, seasons),
        )
      } else if (gameId) {
        const seasons = await this.matchmakingSeasonsService.getAllSeasons()
        const changes = await getRatingChangePoints(client, userId, gameId)
        peakDivision = maxDivision(peakDivision, getPeakDivision(changes, seasons))
      }

      const metrics = { ...(await getTitleMetrics(client, userId)), peakDivision }
      const unearned = getEarnedTitleIds(metrics).filter(id => !held.has(id))
      return await insertEarnedTitles(client, userId, unearned)
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

    return await withDbClient(async client => {
      const [titles, metrics] = await Promise.all([
        getUserTitles(client, userId),
        getTitleMetrics(client, userId),
      ])
      return {
        unlocked: titles.map(toUnlockedJson),
        equipped: titles.find(t => t.equipped)?.id,
        metrics: { ...metrics, peakDivision: getHeldPeakDivision(new Set(titles.map(t => t.id))) },
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
    const equipped = await setUserTitle(userId, titleId === DEFAULT_TITLE_ID ? undefined : titleId)
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
        await setUserTitle(userId, titleId, client)
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
