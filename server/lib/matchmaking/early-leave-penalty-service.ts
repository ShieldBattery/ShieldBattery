import { singleton } from 'tsyringe'
import { ReadonlyDeep } from 'type-fest'
import { GameSource } from '../../../common/games/configuration'
import { getTeamsFromConfig } from '../../../common/games/matchups'
import { NotificationType } from '../../../common/notifications'
import { SbUserId } from '../../../common/users/sb-user-id'
import { GameLifecycleEvents } from '../games/game-lifecycle-events'
import { getGameRecord } from '../games/game-models'
import logger from '../logging/logger'
import { getDepartureEvidenceForGame } from '../models/games-users'
import NotificationService from '../notifications/notification-service'
import { ClientIdentifierString } from '../users/client-ids'
import { findEarlyLeavers } from './early-leave'
import { MatchmakingBanService } from './matchmaking-ban-service'
import { MatchmakingService } from './matchmaking-service'

/**
 * Penalizes players who abandon a matchmaking game shortly after it starts (see
 * `findEarlyLeavers`) with the same escalating matchmaking ban as players who cause a match to fail
 * to start. The game's own results are left as they were.
 *
 * A game is judged once its results are final, so a player is penalized at most once per game, and
 * only for a game with an undisputed outcome that came from its players' reports.
 */
@singleton()
export class EarlyLeavePenaltyService {
  constructor(
    gameLifecycleEvents: GameLifecycleEvents,
    private matchmakingService: MatchmakingService,
    private banService: MatchmakingBanService,
    private notificationService: NotificationService,
  ) {
    gameLifecycleEvents.on('gameReconciled', ({ gameId }) => {
      try {
        // Taken for every reconciled game, so the identifiers of one that won't be penalized are
        // forgotten too
        const identifiers = this.matchmakingService.takeStartedGameIdentifiers(gameId)
        this.penalizeEarlyLeavers(gameId, identifiers).catch(err => {
          logger.error({ err, gameId }, 'error penalizing early leavers of a matchmaking game')
        })
      } catch (err) {
        logger.error({ err, gameId }, 'error penalizing early leavers of a matchmaking game')
      }
    })
  }

  /**
   * Penalizes the early leavers of a game whose results have just been reconciled.
   *
   * @param identifiers The client identifiers each player queued for the game with, if they're
   *   still known. A player without any is banned by account only.
   */
  async penalizeEarlyLeavers(
    gameId: string,
    identifiers?: ReadonlyMap<SbUserId, ReadonlyDeep<ClientIdentifierString[]>>,
  ): Promise<void> {
    const game = await getGameRecord(gameId)
    if (
      !game ||
      game.config.gameSource !== GameSource.Matchmaking ||
      !game.results ||
      // Covers voided games too, which reconcile as disputed
      game.disputable ||
      // Only a lobby violation writes results for a cancelled game, and that game never started.
      // Its offender is penalized for the violation itself.
      game.canceledAt ||
      game.manuallyResolved
    ) {
      return
    }

    const teams = getTeamsFromConfig(game.config)
    if (!teams) {
      return
    }

    const evidence = await getDepartureEvidenceForGame(gameId)
    const leavers = findEarlyLeavers({
      teams: teams.map(team => team.filter(p => !p.isComputer).map(p => p.id)),
      gameLengthMs: game.gameLength,
      gameStartTime: game.startTime,
      players: evidence.map(e => ({
        userId: e.userId,
        departureKind: e.departureKind,
        departureTime: e.departureTime,
        relayReportFrame: e.relayReportFrame,
        report: e.reportedResults,
        result: e.result,
      })),
    })

    // One at a time, since each penalty takes its own transaction
    for (const userId of leavers) {
      try {
        await this.penalize(gameId, userId, identifiers?.get(userId) ?? [])
      } catch (err) {
        logger.error({ err, gameId, userId }, 'error penalizing an early leaver')
      }
    }
  }

  private async penalize(
    gameId: string,
    userId: SbUserId,
    identifiers: ReadonlyDeep<ClientIdentifierString[]>,
  ): Promise<void> {
    const { penalty, needsEnforcement, bannedUntil } = await this.banService.applyGamePenalty(
      userId,
      identifiers,
      gameId,
      'leftEarly',
    )
    if (!needsEnforcement) {
      return
    }

    logger.info({ gameId, userId, penalty }, 'penalized a player for leaving a game early')
    await this.notificationService.addNotification({
      userId,
      data: { type: NotificationType.MatchmakingBan, bannedUntil, reason: 'leftEarly' },
    })
    if (penalty === 'lossAndBan') {
      await this.matchmakingService.enforceGameBan(userId)
    }
    await this.banService.acknowledgeGamePenaltyEnforced(gameId, userId)
  }
}
