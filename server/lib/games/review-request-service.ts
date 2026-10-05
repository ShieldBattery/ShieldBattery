import { singleton } from 'tsyringe'
import { GameSource } from '../../../common/games/configuration'
import { GameRecord, ReviewRequestErrorCode } from '../../../common/games/games'
import { MATCHMAKING_SEASON_FINALIZED_TIME_MS } from '../../../common/matchmaking'
import { SbUserId } from '../../../common/users/sb-user-id'
import { AdminReportCountsService } from '../admin/admin-report-counts-service'
import { CodedError } from '../errors/coded-error'
import { MatchmakingSeasonsService } from '../matchmaking/matchmaking-seasons'
import { Clock } from '../time/clock'
import { dismissReviewRequest, getGameRecord, setReviewRequested } from './game-models'

export class ReviewRequestServiceError extends CodedError<ReviewRequestErrorCode> {}

function isHumanPlayer(game: GameRecord, userId: SbUserId): boolean {
  return game.config.teams.some(team => team.some(p => !p.isComputer && p.id === userId))
}

/**
 * Lets the players of a disputed matchmaking game ask an admin to review its results, and lets
 * admins dismiss such a request without resolving the game. A game can be asked about once: after
 * the request has been resolved or dismissed, its players can't ask again.
 */
@singleton()
export class ReviewRequestService {
  constructor(
    private clock: Clock,
    private seasonsService: MatchmakingSeasonsService,
    private adminReportCountsService: AdminReportCountsService,
  ) {}

  /**
   * Returns why `userId` can't request a review of `game` right now, or `undefined` if they can.
   */
  private async getRequestBlocker(
    game: GameRecord,
    userId: SbUserId,
  ): Promise<ReviewRequestErrorCode | undefined> {
    if (!isHumanPlayer(game, userId)) {
      return ReviewRequestErrorCode.NotParticipant
    }
    if (game.config.gameSource !== GameSource.Matchmaking) {
      return ReviewRequestErrorCode.NotMatchmaking
    }
    if (!game.disputable || game.canceledAt) {
      return ReviewRequestErrorCode.NotDisputed
    }
    if (game.disputeRequested) {
      return ReviewRequestErrorCode.AlreadyRequested
    }

    // Past this point a manual resolution would no longer apply rating, points or ladder win/loss
    // changes (see `applyReconciledResultEffects`), so a review couldn't fix what players lost.
    const [, seasonEnd] = await this.seasonsService.getSeasonForDate(game.startTime)
    if (
      seasonEnd !== undefined &&
      Number(seasonEnd) + MATCHMAKING_SEASON_FINALIZED_TIME_MS <= this.clock.now()
    ) {
      return ReviewRequestErrorCode.SeasonFinalized
    }

    return undefined
  }

  async canRequestReview(game: GameRecord, userId: SbUserId | undefined): Promise<boolean> {
    if (userId === undefined) {
      return false
    }
    return (await this.getRequestBlocker(game, userId)) === undefined
  }

  /** Records that `userId`, a player of `gameId`, asked an admin to review its disputed results. */
  async requestReview({
    gameId,
    userId,
  }: {
    gameId: string
    userId: SbUserId
  }): Promise<GameRecord> {
    const game = await getGameRecord(gameId)
    if (!game) {
      throw new ReviewRequestServiceError(ReviewRequestErrorCode.NotFound, 'no matching game found')
    }

    const blocker = await this.getRequestBlocker(game, userId)
    if (blocker) {
      throw new ReviewRequestServiceError(blocker, 'a review cannot be requested for this game')
    }

    if (!(await setReviewRequested(gameId, new Date(this.clock.now())))) {
      // The game changed since it was read: another player requested a review first, or an admin
      // resolved it.
      const current = await getGameRecord(gameId)
      throw new ReviewRequestServiceError(
        current?.disputeRequested
          ? ReviewRequestErrorCode.AlreadyRequested
          : ReviewRequestErrorCode.NotDisputed,
        'a review cannot be requested for this game',
      )
    }

    this.adminReportCountsService.refresh('reviewRequests')
    return (await getGameRecord(gameId))!
  }

  /** Marks the pending review request for `gameId` as reviewed, leaving the game disputed. */
  async dismissRequest(gameId: string): Promise<GameRecord> {
    if (!(await dismissReviewRequest(gameId))) {
      const game = await getGameRecord(gameId)
      throw new ReviewRequestServiceError(
        game ? ReviewRequestErrorCode.NoPendingRequest : ReviewRequestErrorCode.NotFound,
        game ? 'the game has no pending review request' : 'no matching game found',
      )
    }

    this.adminReportCountsService.refresh('reviewRequests')
    return (await getGameRecord(gameId))!
  }

  /**
   * Updates the admins' pending review request count after something other than this service
   * (a manual resolution) may have closed a request.
   */
  refreshPendingCount() {
    this.adminReportCountsService.refresh('reviewRequests')
  }
}
