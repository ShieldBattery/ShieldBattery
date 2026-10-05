import { beforeEach, describe, expect, test, vi } from 'vitest'
import { GameSource } from '../../../common/games/configuration'
import { GameRecord, ReviewRequestErrorCode } from '../../../common/games/games'
import { MATCHMAKING_SEASON_FINALIZED_TIME_MS } from '../../../common/matchmaking'
import { asMockedFunction } from '../../../common/testing/mocks'
import { makeSbUserId } from '../../../common/users/sb-user-id'
import { FakeClock } from '../time/testing/fake-clock'
import { dismissReviewRequest, getGameRecord, setReviewRequested } from './game-models'
import { ReviewRequestService, ReviewRequestServiceError } from './review-request-service'

vi.mock('../admin/admin-report-counts-service', () => ({ AdminReportCountsService: class {} }))
vi.mock('./game-models', () => ({
  dismissReviewRequest: vi.fn(),
  getGameRecord: vi.fn(),
  setReviewRequested: vi.fn(),
}))

const getGameRecordMock = asMockedFunction(getGameRecord)
const setReviewRequestedMock = asMockedFunction(setReviewRequested)
const dismissReviewRequestMock = asMockedFunction(dismissReviewRequest)

const GAME_ID = 'game-1'
const NOW = Number(new Date('2026-10-05T12:00:00.000Z'))
const PLAYER_A = makeSbUserId(1)
const PLAYER_B = makeSbUserId(2)
const OUTSIDER = makeSbUserId(3)

function makeGame(overrides: Partial<GameRecord> = {}, gameSource = GameSource.Matchmaking) {
  return {
    id: GAME_ID,
    startTime: new Date(NOW - 60 * 60 * 1000),
    config: {
      gameSource,
      teams: [
        [{ id: PLAYER_A, race: 'p', isComputer: false }],
        [{ id: PLAYER_B, race: 'z', isComputer: false }],
      ],
    },
    disputable: true,
    disputeRequested: false,
    disputeReviewed: false,
    canceledAt: null,
    ...overrides,
  } as unknown as GameRecord
}

async function expectErrorCode(promise: Promise<unknown>, code: ReviewRequestErrorCode) {
  const err = await promise.then(
    () => undefined,
    (e: unknown) => e,
  )
  expect(err).toBeInstanceOf(ReviewRequestServiceError)
  expect((err as ReviewRequestServiceError).code).toBe(code)
}

describe('games/review-request-service', () => {
  let seasonEnd: Date | undefined
  let refresh: ReturnType<typeof vi.fn>
  let service: ReviewRequestService

  beforeEach(() => {
    getGameRecordMock.mockReset()
    setReviewRequestedMock.mockReset().mockResolvedValue(true)
    dismissReviewRequestMock.mockReset().mockResolvedValue(true)

    const clock = new FakeClock()
    clock.setCurrentTime(NOW)
    seasonEnd = undefined
    refresh = vi.fn()
    service = new ReviewRequestService(
      clock,
      { getSeasonForDate: vi.fn(async () => [{ id: 1 }, seasonEnd]) } as any,
      { refresh } as any,
    )
  })

  describe('requestReview', () => {
    test('records the request for a player of a disputed matchmaking game', async () => {
      getGameRecordMock.mockResolvedValue(makeGame())

      await service.requestReview({ gameId: GAME_ID, userId: PLAYER_B })

      expect(setReviewRequestedMock).toHaveBeenCalledWith(GAME_ID, new Date(NOW))
      expect(refresh).toHaveBeenCalledWith('reviewRequests')
    })

    test('rejects a user who did not play in the game', async () => {
      getGameRecordMock.mockResolvedValue(makeGame())

      await expectErrorCode(
        service.requestReview({ gameId: GAME_ID, userId: OUTSIDER }),
        ReviewRequestErrorCode.NotParticipant,
      )
      expect(setReviewRequestedMock).not.toHaveBeenCalled()
    })

    test('rejects a custom game', async () => {
      getGameRecordMock.mockResolvedValue(makeGame({}, GameSource.Lobby))

      await expectErrorCode(
        service.requestReview({ gameId: GAME_ID, userId: PLAYER_A }),
        ReviewRequestErrorCode.NotMatchmaking,
      )
    })

    test('rejects a game that is not disputed', async () => {
      getGameRecordMock.mockResolvedValue(makeGame({ disputable: false }))

      await expectErrorCode(
        service.requestReview({ gameId: GAME_ID, userId: PLAYER_A }),
        ReviewRequestErrorCode.NotDisputed,
      )
    })

    test('rejects a second request, including after a dismissal', async () => {
      getGameRecordMock.mockResolvedValue(makeGame({ disputeRequested: true }))
      await expectErrorCode(
        service.requestReview({ gameId: GAME_ID, userId: PLAYER_A }),
        ReviewRequestErrorCode.AlreadyRequested,
      )

      getGameRecordMock.mockResolvedValue(
        makeGame({ disputeRequested: true, disputeReviewed: true }),
      )
      await expectErrorCode(
        service.requestReview({ gameId: GAME_ID, userId: PLAYER_A }),
        ReviewRequestErrorCode.AlreadyRequested,
      )
      expect(setReviewRequestedMock).not.toHaveBeenCalled()
    })

    test("rejects once the game's season is finalized", async () => {
      getGameRecordMock.mockResolvedValue(makeGame())
      seasonEnd = new Date(NOW - MATCHMAKING_SEASON_FINALIZED_TIME_MS)

      await expectErrorCode(
        service.requestReview({ gameId: GAME_ID, userId: PLAYER_A }),
        ReviewRequestErrorCode.SeasonFinalized,
      )
    })

    test('allows requests after the season ends but before it is finalized', async () => {
      getGameRecordMock.mockResolvedValue(makeGame())
      seasonEnd = new Date(NOW - MATCHMAKING_SEASON_FINALIZED_TIME_MS + 1)

      await service.requestReview({ gameId: GAME_ID, userId: PLAYER_A })
      expect(setReviewRequestedMock).toHaveBeenCalled()
    })

    test('reports a request that lost a race with another player as already requested', async () => {
      getGameRecordMock
        .mockResolvedValueOnce(makeGame())
        .mockResolvedValueOnce(makeGame({ disputeRequested: true }))
      setReviewRequestedMock.mockResolvedValue(false)

      await expectErrorCode(
        service.requestReview({ gameId: GAME_ID, userId: PLAYER_A }),
        ReviewRequestErrorCode.AlreadyRequested,
      )
      expect(refresh).not.toHaveBeenCalled()
    })

    test('reports a request that lost a race with a resolution as not disputed', async () => {
      getGameRecordMock
        .mockResolvedValueOnce(makeGame())
        .mockResolvedValueOnce(makeGame({ disputable: false, disputeReviewed: true }))
      setReviewRequestedMock.mockResolvedValue(false)

      await expectErrorCode(
        service.requestReview({ gameId: GAME_ID, userId: PLAYER_A }),
        ReviewRequestErrorCode.NotDisputed,
      )
    })
  })

  describe('canRequestReview', () => {
    test('is true only for a player who could make a request', async () => {
      const game = makeGame()
      expect(await service.canRequestReview(game, PLAYER_A)).toBe(true)
      expect(await service.canRequestReview(game, OUTSIDER)).toBe(false)
      expect(await service.canRequestReview(game, undefined)).toBe(false)
      expect(await service.canRequestReview(makeGame({ disputeRequested: true }), PLAYER_A)).toBe(
        false,
      )
    })
  })

  describe('dismissRequest', () => {
    test('dismisses a pending request', async () => {
      getGameRecordMock.mockResolvedValue(
        makeGame({ disputeRequested: true, disputeReviewed: true }),
      )

      await service.dismissRequest(GAME_ID)

      expect(dismissReviewRequestMock).toHaveBeenCalledWith(GAME_ID)
      expect(refresh).toHaveBeenCalledWith('reviewRequests')
    })

    test('rejects a game with no pending request', async () => {
      dismissReviewRequestMock.mockResolvedValue(false)
      getGameRecordMock.mockResolvedValue(makeGame())

      await expectErrorCode(
        service.dismissRequest(GAME_ID),
        ReviewRequestErrorCode.NoPendingRequest,
      )
      expect(refresh).not.toHaveBeenCalled()
    })

    test('rejects a game that does not exist', async () => {
      dismissReviewRequestMock.mockResolvedValue(false)
      getGameRecordMock.mockResolvedValue(undefined)

      await expectErrorCode(service.dismissRequest(GAME_ID), ReviewRequestErrorCode.NotFound)
    })
  })
})
