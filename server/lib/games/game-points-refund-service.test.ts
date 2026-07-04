import { beforeEach, describe, expect, test, vi } from 'vitest'
import { MatchmakingType } from '../../../common/matchmaking'
import { asMockedFunction } from '../../../common/testing/mocks'
import { makeSbUserId, SbUserId } from '../../../common/users/sb-user-id'
import { updateRankings } from '../ladder/rankings'
import { updateLeaderboards } from '../leagues/leaderboard'
import { getLeagueUserChangesForGame, refundLeaguePoints } from '../leagues/league-models'
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

/** Builds a `MatchmakingRatingChange` with only the fields the service reads. */
function mmChange(
  userId: number,
  pointsChange: number,
  bonusUsedChange = 0,
): MatchmakingRatingChange {
  return {
    userId: makeSbUserId(userId),
    matchmakingType: MatchmakingType.Match1v1,
    pointsChange,
    bonusUsedChange,
  } as MatchmakingRatingChange
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
      mmChange(12, 8), // honest winner (positive change, not refunded)
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
    expect(result.refundedUsers).toEqual([{ userId: makeSbUserId(11), pointsRefunded: 15 }])

    // The audit row records the same refund; the ranking cache is refreshed.
    expect(tryRecordGamePointsRefund).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        gameId: GAME_ID,
        details: [
          {
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
