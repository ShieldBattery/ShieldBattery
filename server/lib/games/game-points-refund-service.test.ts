import { beforeEach, describe, expect, test, vi } from 'vitest'
import { LeagueId } from '../../../common/leagues/leagues'
import { MatchmakingType } from '../../../common/matchmaking'
import { asMockedFunction } from '../../../common/testing/mocks'
import { makeSbUserId, SbUserId } from '../../../common/users/sb-user-id'
import { updateRankings } from '../ladder/rankings'
import { updateLeaderboards } from '../leagues/leaderboard'
import {
  getLeagueUserChangesForGame,
  LeagueUserChange,
  refundLeaguePoints,
} from '../leagues/league-models'
import {
  getMatchmakingRatingChangesForGame,
  MatchmakingRatingChange,
  refundMatchmakingPoints,
} from '../matchmaking/models'
import { getGameRecord } from './game-models'
import { tryRecordGamePointsRefund } from './game-points-refund-models'
import {
  GamePointsRefundErrorCode,
  GamePointsRefundService,
  GamePointsRefundServiceError,
} from './game-points-refund-service'

vi.mock('./game-models', () => ({ getGameRecord: vi.fn() }))
vi.mock('./game-points-refund-models', () => ({ tryRecordGamePointsRefund: vi.fn() }))
vi.mock('../matchmaking/models', () => ({
  getMatchmakingRatingChangesForGame: vi.fn(),
  refundMatchmakingPoints: vi.fn(),
}))
vi.mock('../leagues/league-models', () => ({
  getLeagueUserChangesForGame: vi.fn(),
  refundLeaguePoints: vi.fn(),
}))
vi.mock('../ladder/rankings', () => ({ updateRankings: vi.fn() }))
vi.mock('../leagues/leaderboard', () => ({ updateLeaderboards: vi.fn() }))
// Run the transaction callback immediately with a dummy client.
vi.mock('../db/transaction', () => ({
  default: vi.fn((cb: (client: unknown) => unknown) => cb({})),
}))

const GAME_ID = 'game-1'
const CURRENT_SEASON = { id: 7 } as any

/**
 * Builds a `MatchmakingRatingChange` with only the fields the service reads. `outcome` defaults to
 * matching the sign of `pointsChange` (real wins always net >= +1, losses <= 0), but can be
 * overridden — e.g. a bonus-absorbed loss nets 0 ranked points yet is still a loss.
 */
function mmChange(
  userId: number,
  pointsChange: number,
  bonusUsedChange = 0,
  outcome: 'win' | 'loss' = pointsChange > 0 ? 'win' : 'loss',
): MatchmakingRatingChange {
  return {
    userId: makeSbUserId(userId),
    matchmakingType: MatchmakingType.Match1v1,
    outcome,
    pointsChange,
    bonusUsedChange,
  } as MatchmakingRatingChange
}

/** Builds a `LeagueUserChange` with only the fields the service reads. */
function leagueChange(userId: number, pointsChange: number): LeagueUserChange {
  return {
    userId: makeSbUserId(userId),
    leagueId: 'league-1' as LeagueId,
    pointsChange,
  } as LeagueUserChange
}

describe('GamePointsRefundService', () => {
  let seasonsService: {
    getSeasonForDate: ReturnType<typeof vi.fn>
    getCurrentSeason: ReturnType<typeof vi.fn>
  }
  let notificationService: { addNotification: ReturnType<typeof vi.fn> }
  let service: GamePointsRefundService

  const refund = (punishedUserIds: SbUserId[]) =>
    service.refundGamePoints({ gameId: GAME_ID, punishedUserIds, refundedBy: makeSbUserId(1) })

  beforeEach(() => {
    vi.clearAllMocks()

    seasonsService = {
      getSeasonForDate: vi.fn().mockResolvedValue([CURRENT_SEASON, undefined]),
      getCurrentSeason: vi.fn().mockResolvedValue(CURRENT_SEASON),
    }
    notificationService = { addNotification: vi.fn().mockResolvedValue(undefined) }
    service = new GamePointsRefundService(
      {} as any,
      seasonsService as any,
      notificationService as any,
    )

    asMockedFunction(getGameRecord).mockResolvedValue({ id: GAME_ID, startTime: new Date() } as any)
    asMockedFunction(getLeagueUserChangesForGame).mockResolvedValue([])
    asMockedFunction(tryRecordGamePointsRefund).mockResolvedValue(true)
    asMockedFunction(refundMatchmakingPoints).mockImplementation(
      async (_client, { userId }) => ({ userId, points: 100 }) as any,
    )
    asMockedFunction(refundLeaguePoints).mockResolvedValue(undefined)
    asMockedFunction(updateRankings).mockResolvedValue(undefined)
    asMockedFunction(updateLeaderboards).mockResolvedValue(undefined)
  })

  test('refunds only losers, excludes the punished player, and notifies them', async () => {
    asMockedFunction(getMatchmakingRatingChangesForGame).mockResolvedValue([
      mmChange(10, 20, 10), // punished winner
      mmChange(11, -15, 4), // victim (loser)
      mmChange(12, 8, 5), // honest winner who spent bonus (still not refunded — outcome is a win)
    ])

    const result = await refund([makeSbUserId(10)])

    // Only the losing, non-punished player is refunded.
    expect(refundMatchmakingPoints).toHaveBeenCalledTimes(1)
    expect(refundMatchmakingPoints).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: makeSbUserId(11),
        seasonId: CURRENT_SEASON.id,
        pointsRefund: 15,
        bonusRefund: 4,
      }),
    )
    expect(result.refundedUsers).toEqual([makeSbUserId(11)])

    // The audit row records the same refund; the ranking cache is refreshed.
    expect(tryRecordGamePointsRefund).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        gameId: GAME_ID,
        details: [
          {
            kind: 'matchmaking',
            userId: makeSbUserId(11),
            matchmakingType: MatchmakingType.Match1v1,
            pointsRefunded: 15,
            bonusRefunded: 4,
          },
        ],
      }),
    )
    expect(updateRankings).toHaveBeenCalledTimes(1)

    // Only the refunded victim is notified — not the punished player.
    expect(notificationService.addNotification).toHaveBeenCalledTimes(1)
    expect(notificationService.addNotification).toHaveBeenCalledWith(
      expect.objectContaining({ userId: makeSbUserId(11) }),
    )
  })

  test('refunds bonus-absorbed losers whose net ranked-points change was 0', async () => {
    // For most of a season, a loss is fully covered by the bonus pool: the player nets 0 ranked
    // points but spends bonus. They still lost something, so they must be refunded (bonus restored)
    // — gating on `pointsChange < 0` alone would wrongly refund nobody here.
    asMockedFunction(getMatchmakingRatingChangesForGame).mockResolvedValue([
      mmChange(10, 25, 12), // punished winner
      mmChange(11, 0, 9), // victim whose 9-point loss was entirely bonus-absorbed (nets 0 points)
    ])

    const result = await refund([makeSbUserId(10)])

    expect(refundMatchmakingPoints).toHaveBeenCalledTimes(1)
    expect(refundMatchmakingPoints).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: makeSbUserId(11),
        // -0 from negating a 0-point (bonus-absorbed) loss; harmless — it adds 0 points in the DB
        // and serializes to 0 in the audit row.
        pointsRefund: -0,
        bonusRefund: 9,
      }),
    )
    expect(result.refundedUsers).toEqual([makeSbUserId(11)])
  })

  test('refunds, audits, and notifies league losers too — including league-only ones', async () => {
    asMockedFunction(getMatchmakingRatingChangesForGame).mockResolvedValue([
      mmChange(10, 20), // punished winner
      mmChange(11, -15, 4), // mm + (below) league loser
      mmChange(12, 0), // participant whose mm points were clamped to 0 (no mm refund)
    ])
    asMockedFunction(getLeagueUserChangesForGame).mockResolvedValue([
      leagueChange(11, -8),
      leagueChange(12, -6), // league-only refund (their mm change was 0)
    ])

    const result = await refund([makeSbUserId(10)])

    // Both league losers get their league points restored...
    expect(refundLeaguePoints).toHaveBeenCalledTimes(2)
    // ...and the league-only player (12) is included in the audit, response, and notifications even
    // though they had no matchmaking refund.
    expect(result.refundedUsers).toEqual([makeSbUserId(11), makeSbUserId(12)])
    expect(notificationService.addNotification).toHaveBeenCalledTimes(2)
    expect(notificationService.addNotification).toHaveBeenCalledWith(
      expect.objectContaining({ userId: makeSbUserId(12) }),
    )
    const { details } = asMockedFunction(tryRecordGamePointsRefund).mock.calls[0][1]
    expect(details).toContainEqual({
      kind: 'league',
      userId: makeSbUserId(12),
      leagueId: 'league-1',
      pointsRefunded: 6,
    })
  })

  test('bails with NotRefundable (recording nothing) when the only losers are punished', async () => {
    asMockedFunction(getMatchmakingRatingChangesForGame).mockResolvedValue([
      mmChange(10, -15), // punished loser — excluded
      mmChange(11, 20), // honest winner — not refunded
    ])

    await expect(refund([makeSbUserId(10)])).rejects.toMatchObject({
      code: GamePointsRefundErrorCode.NotRefundable,
    })
    // Crucially, nothing is recorded, so a later legitimate refund isn't locked out.
    expect(tryRecordGamePointsRefund).not.toHaveBeenCalled()
    expect(refundMatchmakingPoints).not.toHaveBeenCalled()
    expect(notificationService.addNotification).not.toHaveBeenCalled()
  })

  test('throws NotRanked when the game has no matchmaking changes at all', async () => {
    asMockedFunction(getMatchmakingRatingChangesForGame).mockResolvedValue([])

    await expect(refund([])).rejects.toMatchObject({
      code: GamePointsRefundErrorCode.NotRanked,
    })
    expect(tryRecordGamePointsRefund).not.toHaveBeenCalled()
  })

  test('throws AlreadyRefunded when the game was already refunded', async () => {
    asMockedFunction(getMatchmakingRatingChangesForGame).mockResolvedValue([
      mmChange(10, 20), // punished participant
      mmChange(11, -15), // a loser to refund (so it reaches the idempotency insert)
    ])
    asMockedFunction(tryRecordGamePointsRefund).mockResolvedValue(false)

    await expect(refund([makeSbUserId(10)])).rejects.toMatchObject({
      code: GamePointsRefundErrorCode.AlreadyRefunded,
    })
    expect(refundMatchmakingPoints).not.toHaveBeenCalled()
  })

  test('throws NotCurrentSeason for a past-season game before touching any points', async () => {
    seasonsService.getCurrentSeason.mockResolvedValue({ id: 8 } as any)

    await expect(refund([makeSbUserId(10)])).rejects.toMatchObject({
      code: GamePointsRefundErrorCode.NotCurrentSeason,
    })
    expect(getMatchmakingRatingChangesForGame).not.toHaveBeenCalled()
  })

  test('throws GameNotFound when the game does not exist', async () => {
    asMockedFunction(getGameRecord).mockResolvedValue(undefined)

    await expect(refund([makeSbUserId(10)])).rejects.toMatchObject({
      code: GamePointsRefundErrorCode.GameNotFound,
    })
  })

  test('throws InvalidPlayers when a punished user did not play the game', async () => {
    asMockedFunction(getMatchmakingRatingChangesForGame).mockResolvedValue([
      mmChange(10, -15),
      mmChange(11, 20),
    ])

    await expect(refund([makeSbUserId(999)])).rejects.toMatchObject({
      code: GamePointsRefundErrorCode.InvalidPlayers,
    })
    expect(tryRecordGamePointsRefund).not.toHaveBeenCalled()
  })

  test('wraps errors as GamePointsRefundServiceError', async () => {
    asMockedFunction(getGameRecord).mockResolvedValue(undefined)
    const err = await refund([makeSbUserId(10)]).catch(e => e)
    expect(err).toBeInstanceOf(GamePointsRefundServiceError)
  })
})
