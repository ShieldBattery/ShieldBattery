import { singleton } from 'tsyringe'
import {
  GamePointsRefundErrorCode,
  GameRecord,
  UserGamesRefundSummary,
} from '../../../common/games/games'
import { NotificationType } from '../../../common/notifications'
import { SbUserId } from '../../../common/users/sb-user-id'
import { DbClient } from '../db'
import transact from '../db/transaction'
import { CodedError } from '../errors/coded-error'
import { updateRankings } from '../ladder/rankings'
import { updateLeaderboards } from '../leagues/leaderboard'
import {
  getLeagueUserChangesForGame,
  LeagueUser,
  refundLeaguePoints,
} from '../leagues/league-models'
import logger from '../logging/logger'
import { MatchmakingSeasonsService } from '../matchmaking/matchmaking-seasons'
import {
  getMatchmakingRatingChangesForGame,
  getRatedGameIdsForUser,
  MatchmakingRating,
  refundMatchmakingPoints,
} from '../matchmaking/models'
import {
  getReplayViolationUserIds,
  markReplayViolationsHandled,
} from '../models/game-replay-violations'
import NotificationService from '../notifications/notification-service'
import { Redis } from '../redis/redis'
import { getGameRecord, lockGameAndCheckReconciled } from './game-models'
import { GamePointsRefundDetail, tryRecordGamePointsRefund } from './game-points-refund-models'

export class GamePointsRefundServiceError extends CodedError<GamePointsRefundErrorCode> {}

/** Errors that mean a game has nothing (more) to refund, rather than that refunding it failed. */
const NOTHING_TO_REFUND_CODES: ReadonlyArray<GamePointsRefundErrorCode> = [
  GamePointsRefundErrorCode.NotCurrentSeason,
  GamePointsRefundErrorCode.NotRanked,
  GamePointsRefundErrorCode.NotRefundable,
  GamePointsRefundErrorCode.AlreadyRefunded,
]

function isNothingToRefund(err: unknown): boolean {
  return err instanceof GamePointsRefundServiceError && NOTHING_TO_REFUND_CODES.includes(err.code)
}

export interface RefundGamePointsResult {
  refundedUsers: SbUserId[]
}

interface AppliedRefund extends RefundGamePointsResult {
  updatedRatings: MatchmakingRating[]
  updatedLeagueUsers: LeagueUser[]
}

@singleton()
export class GamePointsRefundService {
  constructor(
    private redis: Redis,
    private seasonsService: MatchmakingSeasonsService,
    private notificationService: NotificationService,
  ) {}

  /**
   * Refunds the matchmaking (and league) points lost by everyone who played `gameId` *except* the
   * players in `punishedUserIds`. Only negative point changes are refunded (so honest winners keep
   * their gains), MMR is left untouched (it self-corrects), and the game is refunded at most once.
   * Limited to the current season, since past seasons are finalized.
   */
  async refundGamePoints({
    gameId,
    punishedUserIds,
    refundedBy,
  }: {
    gameId: string
    punishedUserIds: ReadonlyArray<SbUserId>
    refundedBy: SbUserId
  }): Promise<RefundGamePointsResult> {
    const refund = await this.refundGame({ gameId, punishedUserIds, refundedBy })
    await this.refreshCaches(refund.updatedRatings, refund.updatedLeagueUsers)
    await this.notifyRefunded(
      new Map(refund.refundedUsers.map(id => [id, 1])),
      soleCulprit(punishedUserIds),
    )
    return { refundedUsers: refund.refundedUsers }
  }

  /**
   * Refunds every current-season ranked game `userId` played, with them as the only punished player
   * in each (e.g. when they're banned for cheating). Each game is refunded in its own transaction,
   * one at a time, so a failure leaves the other games' refunds in place, and a game that was
   * already refunded (or where only `userId` lost points) is skipped. Each refunded player gets one
   * notification covering all of their refunded games.
   */
  async refundUserGames({
    userId,
    refundedBy,
  }: {
    userId: SbUserId
    refundedBy: SbUserId
  }): Promise<UserGamesRefundSummary> {
    const currentSeason = await this.seasonsService.getCurrentSeason()
    const gameIds = await getRatedGameIdsForUser(userId, currentSeason.startDate)

    const summary: UserGamesRefundSummary = { refundedGames: 0, skippedGames: 0, failedGames: 0 }
    // The latest state of everything the refunds touched, so the caches are refreshed once at the
    // end rather than once per game.
    const ratings = new Map<string, MatchmakingRating>()
    const leagueUsers = new Map<string, LeagueUser>()
    const refundedGameCounts = new Map<SbUserId, number>()
    for (const gameId of gameIds) {
      try {
        const refund = await this.refundGame({ gameId, punishedUserIds: [userId], refundedBy })
        summary.refundedGames += 1
        for (const r of refund.updatedRatings) {
          ratings.set(`${r.seasonId}:${r.matchmakingType}:${r.userId}`, r)
        }
        for (const u of refund.updatedLeagueUsers) {
          leagueUsers.set(`${u.leagueId}:${u.userId}`, u)
        }
        for (const id of refund.refundedUsers) {
          refundedGameCounts.set(id, (refundedGameCounts.get(id) ?? 0) + 1)
        }
      } catch (err) {
        if (isNothingToRefund(err)) {
          summary.skippedGames += 1
        } else {
          logger.error({ err, gameId, userId }, "error refunding one of a user's games")
          summary.failedGames += 1
        }
      }
    }

    await this.refreshCaches(Array.from(ratings.values()), Array.from(leagueUsers.values()))
    await this.notifyRefunded(refundedGameCounts, userId)
    return summary
  }

  /**
   * Restores innocent players' losses after reconciliation. Pending violations remain retryable
   * until results exist, and their completion commits atomically with any point restoration.
   */
  async refundReplayViolation(gameId: string): Promise<void> {
    const refund = await transact(async client => {
      await lockGameAndCheckReconciled(client, gameId)
      const game = await getGameRecord(gameId, client)
      if (!game || (game.results === null && !game.canceledAt)) {
        return undefined
      }
      const punishedUserIds = await getReplayViolationUserIds(client, gameId)
      if (!punishedUserIds.length) {
        return undefined
      }

      let applied: AppliedRefund | undefined
      try {
        // Refunds are final per game. A later violation cannot claw back points already restored
        // to that player or trigger another refund for the remaining players.
        applied = await this.applyRefund(client, { game, punishedUserIds })
      } catch (err) {
        if (!isNothingToRefund(err)) {
          throw err
        }
      }
      await markReplayViolationsHandled(client, gameId)
      return applied && { ...applied, punishedUserIds }
    })
    if (refund) {
      await this.refreshCaches(refund.updatedRatings, refund.updatedLeagueUsers)
      await this.notifyRefunded(
        new Map(refund.refundedUsers.map(id => [id, 1])),
        soleCulprit(refund.punishedUserIds),
      )
    }
  }

  /** Refunds one game in its own transaction, leaving the caches and notifications to the caller. */
  private async refundGame({
    gameId,
    punishedUserIds,
    refundedBy,
  }: {
    gameId: string
    punishedUserIds: ReadonlyArray<SbUserId>
    refundedBy: SbUserId
  }): Promise<AppliedRefund> {
    return await transact(async client => {
      await lockGameAndCheckReconciled(client, gameId)
      const game = await getGameRecord(gameId, client)
      if (!game) {
        throw new GamePointsRefundServiceError(
          GamePointsRefundErrorCode.GameNotFound,
          'Game not found',
        )
      }
      return this.applyRefund(client, { game, punishedUserIds, refundedBy })
    })
  }

  private async applyRefund(
    client: DbClient,
    {
      game,
      punishedUserIds,
      refundedBy,
    }: {
      game: GameRecord
      punishedUserIds: ReadonlyArray<SbUserId>
      refundedBy?: SbUserId
    },
  ): Promise<AppliedRefund> {
    const gameId = game.id
    const [gameSeason, currentSeason] = await Promise.all([
      this.seasonsService.getSeasonForDate(game.startTime).then(([season]) => season),
      this.seasonsService.getCurrentSeason(),
    ])
    if (gameSeason.id !== currentSeason.id) {
      throw new GamePointsRefundServiceError(
        GamePointsRefundErrorCode.NotCurrentSeason,
        'Only current-season games can have their points refunded',
      )
    }

    const [mmChanges, leagueChanges] = await Promise.all([
      getMatchmakingRatingChangesForGame(gameId, client),
      getLeagueUserChangesForGame(gameId, client),
    ])
    if (!mmChanges.length) {
      throw new GamePointsRefundServiceError(
        GamePointsRefundErrorCode.NotRanked,
        'This game has no matchmaking points to refund',
      )
    }

    const participants = new Set(mmChanges.map(c => c.userId))
    // Administrative requests must name ranked participants. A recorded violator may have no
    // rating changes because result protection suppressed them before reconciliation.
    for (const id of refundedBy === undefined ? [] : punishedUserIds) {
      if (!participants.has(id)) {
        throw new GamePointsRefundServiceError(
          GamePointsRefundErrorCode.InvalidPlayers,
          'A punished player did not participate in this game',
        )
      }
    }

    const punished = new Set(punishedUserIds)
    // Refund every non-punished loser who actually spent something on this game. A matchmaking loss
    // costs either ranked points (`pointsChange < 0`) or, when the season's bonus pool absorbs the
    // loss, bonus points (`bonusUsedChange > 0`) instead — and for most of a season losses are fully
    // bonus-absorbed, leaving `pointsChange` at 0 with the loss visible only as spent bonus, so
    // gating on `pointsChange < 0` alone would refund nobody. We refund both. Winners also spend
    // bonus (it amplifies their gains), so we gate on `outcome === 'loss'` to keep honest winners'
    // gains rather than clawing them back. The punished player(s) are excluded — note the victims
    // often include the punished player's own allies (a griefer's teammates), which is why we refund
    // "everyone else" rather than "the other team".
    const mmRefunds = mmChanges.filter(
      c =>
        !punished.has(c.userId) &&
        c.outcome === 'loss' &&
        (c.pointsChange < 0 || c.bonusUsedChange > 0),
    )
    const leagueRefunds = leagueChanges.filter(c => !punished.has(c.userId) && c.pointsChange < 0)

    // Nothing to refund (e.g. the only players who lost points are the punished ones). Bail without
    // recording a refund — otherwise the per-game idempotency row would mark the game refunded and
    // lock out a later, legitimate refund (e.g. after correcting the punished-player set).
    if (!mmRefunds.length && !leagueRefunds.length) {
      throw new GamePointsRefundServiceError(
        GamePointsRefundErrorCode.NotRefundable,
        'No players lost points in this game that can be refunded',
      )
    }

    // Audit every restoration — matchmaking and league — so a league-only refund still leaves a
    // trace (and doesn't lock the game with an empty audit row).
    const details: GamePointsRefundDetail[] = [
      ...mmRefunds.map((c): GamePointsRefundDetail => ({
        kind: 'matchmaking',
        userId: c.userId,
        matchmakingType: c.matchmakingType,
        pointsRefunded: -c.pointsChange,
        bonusRefunded: c.bonusUsedChange,
      })),
      ...leagueRefunds.map((c): GamePointsRefundDetail => ({
        kind: 'league',
        userId: c.userId,
        leagueId: c.leagueId,
        pointsRefunded: -c.pointsChange,
      })),
    ]

    // Everyone who got any points back (matchmaking and/or league) — for the notifications and the
    // response. Deduped, since the common case refunds a player in both.
    const refundedUserIds = [...new Set([...mmRefunds, ...leagueRefunds].map(c => c.userId))]

    const recorded = await tryRecordGamePointsRefund(client, { gameId, refundedBy, details })
    if (!recorded) {
      throw new GamePointsRefundServiceError(
        GamePointsRefundErrorCode.AlreadyRefunded,
        "This game's points have already been refunded",
      )
    }

    const updatedRatings: MatchmakingRating[] = []
    for (const c of mmRefunds) {
      const updated = await refundMatchmakingPoints(client, {
        userId: c.userId,
        matchmakingType: c.matchmakingType,
        seasonId: currentSeason.id,
        pointsRefund: -c.pointsChange,
        bonusRefund: c.bonusUsedChange,
      })
      if (updated) {
        updatedRatings.push(updated)
      }
    }

    const updatedLeagueUsers: LeagueUser[] = []
    for (const c of leagueRefunds) {
      const updated = await refundLeaguePoints(client, {
        userId: c.userId,
        leagueId: c.leagueId,
        pointsRefund: -c.pointsChange,
        gameId,
      })
      if (updated) {
        updatedLeagueUsers.push(updated)
      }
    }

    return { refundedUsers: refundedUserIds, updatedRatings, updatedLeagueUsers }
  }

  /**
   * Refreshes the ranking/leaderboard caches (Redis sorted sets Node maintains from game results).
   * Best-effort, like game-result-service: the DB is already consistent, and these caches can be
   * regenerated from it at any time, so a failure here shouldn't fail the refund.
   */
  private async refreshCaches(
    updatedRatings: ReadonlyArray<MatchmakingRating>,
    updatedLeagueUsers: ReadonlyArray<LeagueUser>,
  ): Promise<void> {
    try {
      await updateRankings(this.redis, updatedRatings)
      await updateLeaderboards(this.redis, updatedLeagueUsers)
    } catch (err) {
      logger.error({ err }, 'error refreshing ranking/leaderboard caches after a points refund')
    }
  }

  /**
   * Lets each refunded player know how many of their games were refunded, and who caused the
   * refund when that's one player. Best-effort: the refund itself has already been applied, so a
   * notification failure shouldn't fail the request.
   */
  private async notifyRefunded(
    refundedGameCounts: ReadonlyMap<SbUserId, number>,
    culpritId: SbUserId | undefined,
  ): Promise<void> {
    // Players with the same count get the same notification, so each count is one insert.
    const usersByGameCount = new Map<number, SbUserId[]>()
    for (const [userId, gameCount] of refundedGameCounts) {
      const userIds = usersByGameCount.get(gameCount) ?? []
      userIds.push(userId)
      usersByGameCount.set(gameCount, userIds)
    }

    try {
      for (const [gameCount, userIds] of usersByGameCount) {
        await this.notificationService.addNotificationForUsers({
          userIds,
          data: { type: NotificationType.GamePointsRefunded, gameCount, culpritId },
        })
      }
    } catch (err) {
      logger.error({ err }, 'error notifying players of a points refund')
    }
  }
}

/** The player a refund is attributed to in notifications, when exactly one player was punished. */
function soleCulprit(punishedUserIds: ReadonlyArray<SbUserId>): SbUserId | undefined {
  return punishedUserIds.length === 1 ? punishedUserIds[0] : undefined
}
