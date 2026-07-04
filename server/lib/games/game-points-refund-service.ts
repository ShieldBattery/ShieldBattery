import { singleton } from 'tsyringe'
import { NotificationType } from '../../../common/notifications'
import { SbUserId } from '../../../common/users/sb-user-id'
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
  MatchmakingRating,
  refundMatchmakingPoints,
} from '../matchmaking/models'
import NotificationService from '../notifications/notification-service'
import { Redis } from '../redis/redis'
import { getGameRecord } from './game-models'
import { GamePointsRefundDetail, tryRecordGamePointsRefund } from './game-points-refund-models'

export enum GamePointsRefundErrorCode {
  /** No game exists with the given id. */
  GameNotFound = 'gameNotFound',
  /** The game isn't in the current season, so its points aren't refundable. */
  NotCurrentSeason = 'notCurrentSeason',
  /** The game has no matchmaking point changes to refund (e.g. it wasn't a ranked game). */
  NotRefundable = 'notRefundable',
  /** A punished user id isn't among the game's participants. */
  InvalidPlayers = 'invalidPlayers',
  /** The game's points have already been refunded. */
  AlreadyRefunded = 'alreadyRefunded',
}

export class GamePointsRefundServiceError extends CodedError<GamePointsRefundErrorCode> {}

export interface RefundGamePointsResult {
  refundedUsers: Array<{ userId: SbUserId; pointsRefunded: number }>
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
    const game = await getGameRecord(gameId)
    if (!game) {
      throw new GamePointsRefundServiceError(
        GamePointsRefundErrorCode.GameNotFound,
        'Game not found',
      )
    }

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
      getMatchmakingRatingChangesForGame(gameId),
      getLeagueUserChangesForGame(gameId),
    ])
    if (!mmChanges.length) {
      throw new GamePointsRefundServiceError(
        GamePointsRefundErrorCode.NotRefundable,
        'This game has no matchmaking points to refund',
      )
    }

    const participants = new Set(mmChanges.map(c => c.userId))
    for (const id of punishedUserIds) {
      if (!participants.has(id)) {
        throw new GamePointsRefundServiceError(
          GamePointsRefundErrorCode.InvalidPlayers,
          'A punished player did not participate in this game',
        )
      }
    }

    const punished = new Set(punishedUserIds)
    // Refund only losses (negative point changes); honest winners keep their gains. The punished
    // player(s) are excluded — note the victims often include the punished player's own allies
    // (a griefer's teammates), which is why we refund "everyone else" rather than "the other team".
    const mmRefunds = mmChanges.filter(c => !punished.has(c.userId) && c.pointsChange < 0)
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

    const details: GamePointsRefundDetail[] = mmRefunds.map(c => ({
      userId: c.userId,
      matchmakingType: c.matchmakingType,
      pointsRefunded: -c.pointsChange,
      bonusRefunded: c.bonusUsedChange,
    }))

    const { updatedRatings, updatedLeagueUsers } = await transact(async client => {
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
        })
        if (updated) {
          updatedLeagueUsers.push(updated)
        }
      }

      return { updatedRatings, updatedLeagueUsers }
    })

    // Refresh the ranking/leaderboard caches (Redis sorted sets Node maintains from game results).
    // Best-effort, like game-result-service: the DB is already consistent, and these caches can be
    // regenerated from it at any time, so a failure here shouldn't fail the refund.
    try {
      await updateRankings(this.redis, updatedRatings)
      await updateLeaderboards(this.redis, updatedLeagueUsers)
    } catch (err) {
      logger.error({ err }, 'error refreshing ranking/leaderboard caches after a points refund')
    }

    // Let the refunded players know their points were restored. Best-effort — the refund itself has
    // already been applied, so a notification failure shouldn't fail the request.
    try {
      await Promise.all(
        details.map(d =>
          this.notificationService.addNotification({
            userId: d.userId,
            data: { type: NotificationType.GamePointsRefunded },
          }),
        ),
      )
    } catch (err) {
      logger.error({ err }, 'error notifying players of a points refund')
    }

    return {
      refundedUsers: details.map(d => ({ userId: d.userId, pointsRefunded: d.pointsRefunded })),
    }
  }
}
