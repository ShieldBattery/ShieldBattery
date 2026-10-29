import { beforeEach, describe, expect, test, vi } from 'vitest'
import { GamePointsRefundErrorCode } from '../../../common/games/games'
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
  getRatedGameIdsForUser,
  MatchmakingRatingChange,
  refundMatchmakingPoints,
} from '../matchmaking/models'
import {
  getReplayViolationUserIds,
  markReplayViolationsHandled,
} from '../models/game-replay-violations'
import { getGameRecord, lockGameAndCheckReconciled } from './game-models'
import { tryRecordGamePointsRefund } from './game-points-refund-models'
import { GamePointsRefundService, GamePointsRefundServiceError } from './game-points-refund-service'

vi.mock('./game-models', () => ({
  getGameRecord: vi.fn(),
  lockGameAndCheckReconciled: vi.fn(),
}))
vi.mock('../models/game-replay-violations', () => ({
  getReplayViolationUserIds: vi.fn(),
  markReplayViolationsHandled: vi.fn(),
}))
vi.mock('./game-points-refund-models', () => ({ tryRecordGamePointsRefund: vi.fn() }))
vi.mock('../matchmaking/models', () => ({
  getMatchmakingRatingChangesForGame: vi.fn(),
  getRatedGameIdsForUser: vi.fn(),
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
const CURRENT_SEASON = { id: 7, startDate: new Date('2026-10-01T00:00:00Z') } as any

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

    asMockedFunction(getGameRecord).mockResolvedValue({
      id: GAME_ID,
      startTime: new Date(),
      results: [],
      canceledAt: null,
    } as any)
    asMockedFunction(getLeagueUserChangesForGame).mockResolvedValue([])
    asMockedFunction(lockGameAndCheckReconciled).mockResolvedValue(true)
    asMockedFunction(getReplayViolationUserIds).mockResolvedValue([makeSbUserId(10)])
    asMockedFunction(markReplayViolationsHandled).mockResolvedValue(undefined)
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

  test('refunds every loser when nobody is punished', async () => {
    asMockedFunction(getMatchmakingRatingChangesForGame).mockResolvedValue([
      mmChange(10, -15, 3),
      mmChange(11, 20),
      mmChange(12, -12),
    ])

    const result = await refund([])

    expect(result.refundedUsers).toEqual([makeSbUserId(10), makeSbUserId(12)])
    expect(refundMatchmakingPoints).toHaveBeenCalledTimes(2)
  })

  describe('refundUserGames', () => {
    const BANNED = makeSbUserId(10)
    const ADMIN = makeSbUserId(1)
    const refundUserGames = () => service.refundUserGames({ userId: BANNED, refundedBy: ADMIN })

    beforeEach(() => {
      asMockedFunction(getGameRecord).mockImplementation(
        async id => ({ id, startTime: new Date(), results: [], canceledAt: null }) as any,
      )
    })

    test("refunds each of the user's current-season games with them as the punished player", async () => {
      asMockedFunction(getRatedGameIdsForUser).mockResolvedValue(['game-a', 'game-b'])
      asMockedFunction(getMatchmakingRatingChangesForGame).mockResolvedValue([
        mmChange(10, 20),
        mmChange(11, -15),
      ])

      const summary = await refundUserGames()

      expect(getRatedGameIdsForUser).toHaveBeenCalledWith(BANNED, CURRENT_SEASON.startDate)
      expect(summary).toEqual({ refundedGames: 2, skippedGames: 0, failedGames: 0 })
      expect(asMockedFunction(tryRecordGamePointsRefund).mock.calls.map(([, r]) => r)).toEqual([
        expect.objectContaining({ gameId: 'game-a', refundedBy: ADMIN }),
        expect.objectContaining({ gameId: 'game-b', refundedBy: ADMIN }),
      ])
      for (const [, change] of asMockedFunction(refundMatchmakingPoints).mock.calls) {
        expect(change.userId).toBe(makeSbUserId(11))
      }
      // One notification per refunded game, even for the same player.
      expect(notificationService.addNotification).toHaveBeenCalledTimes(2)
    })

    test('skips games with nothing to refund and keeps going past a failed one', async () => {
      asMockedFunction(getRatedGameIdsForUser).mockResolvedValue([
        'game-lost',
        'game-broken',
        'game-won',
      ])
      asMockedFunction(lockGameAndCheckReconciled).mockImplementation(async (_client, id) => {
        if (id === 'game-broken') {
          throw new Error('database unavailable')
        }
        return true
      })
      asMockedFunction(getMatchmakingRatingChangesForGame).mockImplementation(async id =>
        id === 'game-lost'
          ? [mmChange(10, -15), mmChange(11, 20)] // only the banned player lost
          : [mmChange(10, 20), mmChange(11, -15)],
      )

      const summary = await refundUserGames()

      expect(summary).toEqual({ refundedGames: 1, skippedGames: 1, failedGames: 1 })
      expect(tryRecordGamePointsRefund).toHaveBeenCalledTimes(1)
      expect(tryRecordGamePointsRefund).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ gameId: 'game-won' }),
      )
    })

    test('counts games that were already refunded as skipped', async () => {
      asMockedFunction(getRatedGameIdsForUser).mockResolvedValue(['game-a'])
      asMockedFunction(getMatchmakingRatingChangesForGame).mockResolvedValue([
        mmChange(10, 20),
        mmChange(11, -15),
      ])
      asMockedFunction(tryRecordGamePointsRefund).mockResolvedValue(false)

      expect(await refundUserGames()).toEqual({
        refundedGames: 0,
        skippedGames: 1,
        failedGames: 0,
      })
      expect(refundMatchmakingPoints).not.toHaveBeenCalled()
    })
  })

  describe('refundReplayViolation', () => {
    const refundViolation = () => service.refundReplayViolation(GAME_ID)

    beforeEach(() => {
      asMockedFunction(getMatchmakingRatingChangesForGame).mockResolvedValue([
        mmChange(10, 20),
        mmChange(11, -15, 4),
      ])
    })

    test('refunds innocent losses and bonus, excludes all violators, and preserves winners', async () => {
      asMockedFunction(getReplayViolationUserIds).mockResolvedValue([
        makeSbUserId(10),
        makeSbUserId(12),
      ])
      asMockedFunction(getMatchmakingRatingChangesForGame).mockResolvedValue([
        mmChange(10, 20),
        mmChange(11, -15, 4),
        mmChange(12, -10, 2),
        mmChange(13, 0, 9),
        mmChange(14, 20, 10),
      ])
      asMockedFunction(getLeagueUserChangesForGame).mockResolvedValue([
        leagueChange(11, -8),
        leagueChange(12, -6),
        leagueChange(14, 10),
      ])

      await refundViolation()

      expect(refundMatchmakingPoints).toHaveBeenCalledTimes(2)
      expect(asMockedFunction(refundMatchmakingPoints).mock.calls.map(([, c]) => c)).toEqual([
        {
          userId: makeSbUserId(11),
          matchmakingType: MatchmakingType.Match1v1,
          seasonId: CURRENT_SEASON.id,
          pointsRefund: 15,
          bonusRefund: 4,
        },
        {
          userId: makeSbUserId(13),
          matchmakingType: MatchmakingType.Match1v1,
          seasonId: CURRENT_SEASON.id,
          pointsRefund: -0,
          bonusRefund: 9,
        },
      ])
      expect(refundLeaguePoints).toHaveBeenCalledTimes(1)
      expect(refundLeaguePoints).toHaveBeenCalledWith(expect.anything(), {
        userId: makeSbUserId(11),
        leagueId: 'league-1',
        pointsRefund: 8,
        gameId: GAME_ID,
      })
      expect(tryRecordGamePointsRefund).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ refundedBy: undefined }),
      )
      expect(markReplayViolationsHandled).toHaveBeenCalledWith(expect.anything(), GAME_ID)
      expect(notificationService.addNotification).toHaveBeenCalledTimes(2)
    })

    test('locks before reading and uses the same transaction for reads, refunds, and completion', async () => {
      asMockedFunction(lockGameAndCheckReconciled).mockImplementationOnce(async () => {
        expect(getGameRecord).not.toHaveBeenCalled()
        expect(getReplayViolationUserIds).not.toHaveBeenCalled()
        return true
      })
      asMockedFunction(markReplayViolationsHandled).mockImplementationOnce(async () => {
        expect(refundMatchmakingPoints).toHaveBeenCalledTimes(1)
        expect(updateRankings).not.toHaveBeenCalled()
        expect(notificationService.addNotification).not.toHaveBeenCalled()
      })
      await refundViolation()

      const client = asMockedFunction(lockGameAndCheckReconciled).mock.calls[0][0]
      expect(getGameRecord).toHaveBeenCalledWith(GAME_ID, client)
      expect(getReplayViolationUserIds).toHaveBeenCalledWith(client, GAME_ID)
      expect(getMatchmakingRatingChangesForGame).toHaveBeenCalledWith(GAME_ID, client)
      expect(getLeagueUserChangesForGame).toHaveBeenCalledWith(GAME_ID, client)
      expect(tryRecordGamePointsRefund).toHaveBeenCalledWith(client, expect.anything())
      expect(refundMatchmakingPoints).toHaveBeenCalledWith(client, expect.anything())
      expect(markReplayViolationsHandled).toHaveBeenCalledWith(client, GAME_ID)
      expect(updateRankings).toHaveBeenCalledTimes(1)
    })

    test('leaves an unreconciled game pending, then refunds after reconciliation', async () => {
      asMockedFunction(getGameRecord).mockResolvedValueOnce({
        id: GAME_ID,
        startTime: new Date(),
        results: null,
        canceledAt: null,
      } as any)
      await refundViolation()
      expect(markReplayViolationsHandled).not.toHaveBeenCalled()
      expect(tryRecordGamePointsRefund).not.toHaveBeenCalled()
      await refundViolation()
      expect(markReplayViolationsHandled).toHaveBeenCalledTimes(1)
      expect(refundMatchmakingPoints).toHaveBeenCalledTimes(1)
    })

    test('does nothing when there are no violations', async () => {
      asMockedFunction(getReplayViolationUserIds).mockResolvedValue([])
      await refundViolation()
      expect(tryRecordGamePointsRefund).not.toHaveBeenCalled()
      expect(markReplayViolationsHandled).not.toHaveBeenCalled()
    })

    test('shares the idempotency guard with administrative refunds', async () => {
      asMockedFunction(tryRecordGamePointsRefund)
        .mockResolvedValueOnce(true)
        .mockResolvedValue(false)
      await refund([makeSbUserId(10)])
      await refundViolation()
      await refundViolation()
      expect(refundMatchmakingPoints).toHaveBeenCalledTimes(1)
      expect(notificationService.addNotification).toHaveBeenCalledTimes(1)
      expect(markReplayViolationsHandled).toHaveBeenCalledTimes(2)
    })

    test('blocks an administrative duplicate after an automatic refund', async () => {
      asMockedFunction(tryRecordGamePointsRefund)
        .mockResolvedValueOnce(true)
        .mockResolvedValue(false)
      await refundViolation()
      await expect(refund([makeSbUserId(10)])).rejects.toMatchObject({
        code: GamePointsRefundErrorCode.AlreadyRefunded,
      })
      expect(refundMatchmakingPoints).toHaveBeenCalledTimes(1)
    })

    test('finishes a prior-season violation without changing points', async () => {
      seasonsService.getCurrentSeason.mockResolvedValue({ id: 8 })
      await refundViolation()
      expect(markReplayViolationsHandled).toHaveBeenCalledTimes(1)
      expect(getMatchmakingRatingChangesForGame).not.toHaveBeenCalled()
      expect(tryRecordGamePointsRefund).not.toHaveBeenCalled()
    })

    test.each([
      { results: [], disputable: false, canceledAt: null },
      { results: [], disputable: true, canceledAt: null },
      { results: null, disputable: false, canceledAt: new Date() },
    ])('finishes a terminal game without ranked changes: %j', async state => {
      asMockedFunction(getGameRecord).mockResolvedValue({
        id: GAME_ID,
        startTime: new Date(),
        ...state,
      } as any)
      asMockedFunction(getMatchmakingRatingChangesForGame).mockResolvedValue([])
      await refundViolation()
      expect(markReplayViolationsHandled).toHaveBeenCalledTimes(1)
      expect(tryRecordGamePointsRefund).not.toHaveBeenCalled()
      expect(notificationService.addNotification).not.toHaveBeenCalled()
    })

    test('finishes without a refund when every loss belongs to a violator', async () => {
      asMockedFunction(getMatchmakingRatingChangesForGame).mockResolvedValue([
        mmChange(10, -15),
        mmChange(11, 20),
      ])
      await refundViolation()
      expect(markReplayViolationsHandled).toHaveBeenCalledTimes(1)
      expect(tryRecordGamePointsRefund).not.toHaveBeenCalled()
      expect(refundMatchmakingPoints).not.toHaveBeenCalled()
    })

    test('observer IDs do not prevent innocent players from receiving refunds', async () => {
      asMockedFunction(getReplayViolationUserIds).mockResolvedValue([makeSbUserId(999)])
      await refundViolation()
      expect(refundMatchmakingPoints).toHaveBeenCalledTimes(1)
      expect(markReplayViolationsHandled).toHaveBeenCalledTimes(1)
    })

    test('a partial refund failure aborts completion and remains retryable', async () => {
      asMockedFunction(getLeagueUserChangesForGame).mockResolvedValue([leagueChange(11, -8)])
      asMockedFunction(refundLeaguePoints).mockRejectedValueOnce(new Error('database unavailable'))
      await expect(refundViolation()).rejects.toThrow('database unavailable')
      expect(refundMatchmakingPoints).toHaveBeenCalledTimes(1)
      expect(markReplayViolationsHandled).not.toHaveBeenCalled()
      expect(updateRankings).not.toHaveBeenCalled()
      expect(notificationService.addNotification).not.toHaveBeenCalled()

      await refundViolation()
      expect(markReplayViolationsHandled).toHaveBeenCalledTimes(1)
      expect(notificationService.addNotification).toHaveBeenCalledTimes(1)
    })

    test('a completion failure fails the transaction without publishing notifications', async () => {
      asMockedFunction(markReplayViolationsHandled).mockRejectedValueOnce(new Error('write failed'))
      await expect(refundViolation()).rejects.toThrow('write failed')
      expect(updateRankings).not.toHaveBeenCalled()
      expect(notificationService.addNotification).not.toHaveBeenCalled()
    })

    test('cache and notification failures do not fail a committed refund', async () => {
      asMockedFunction(updateRankings).mockRejectedValueOnce(new Error('cache unavailable'))
      notificationService.addNotification.mockRejectedValueOnce(
        new Error('notification unavailable'),
      )
      await expect(refundViolation()).resolves.toBeUndefined()
      expect(markReplayViolationsHandled).toHaveBeenCalledTimes(1)
    })
  })
})
