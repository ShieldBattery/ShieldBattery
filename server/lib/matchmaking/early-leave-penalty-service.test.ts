import { beforeEach, describe, expect, Mock, test, vi } from 'vitest'

const { getGameRecord, getDepartureEvidenceForGame, loggerError } = vi.hoisted(() => ({
  getGameRecord: vi.fn(),
  getDepartureEvidenceForGame: vi.fn(),
  loggerError: vi.fn(),
}))

vi.mock('tsyringe', () => ({
  container: { resolve: vi.fn() },
  singleton: () => (target: unknown) => target,
  injectable: () => (target: unknown) => target,
  inject: () => () => {},
  delay: (next: unknown) => next,
}))
vi.mock('../logging/logger', () => ({ default: { error: loggerError, info: vi.fn() } }))
vi.mock('../games/game-models', () => ({ getGameRecord }))
vi.mock('../models/games-users', () => ({ getDepartureEvidenceForGame }))
vi.mock('./matchmaking-service', () => ({ MatchmakingService: class {} }))
vi.mock('./matchmaking-ban-service', () => ({ MatchmakingBanService: class {} }))
vi.mock('../notifications/notification-service', () => ({ default: class {} }))

import { GameSource } from '../../../common/games/configuration'
import { GameClientResult } from '../../../common/games/results'
import { NotificationType } from '../../../common/notifications'
import { makeSbUserId, SbUserId } from '../../../common/users/sb-user-id'
import { GameLifecycleEvents } from '../games/game-lifecycle-events'
import { GameUserDepartureEvidence } from '../models/games-users'
import { EarlyLeavePenaltyService } from './early-leave-penalty-service'

const GAME_ID = '11111111-2222-4333-8444-555555555555'
const QUITTER = makeSbUserId(1)
const WINNER = makeSbUserId(2)
const START = new Date('2026-11-01T12:00:00Z')
const IDENTIFIERS = [[1, 'a'.repeat(64)]] as any

function makeGame(overrides: Record<string, unknown> = {}) {
  return {
    id: GAME_ID,
    startTime: START,
    config: {
      gameSource: GameSource.Matchmaking,
      teams: [
        [
          { id: QUITTER, race: 'p', isComputer: false },
          { id: WINNER, race: 'z', isComputer: false },
        ],
      ],
    },
    disputable: false,
    gameLength: 31_000,
    results: [
      [QUITTER, { result: 'loss', race: 'p', apm: 0 }],
      [WINNER, { result: 'win', race: 'z', apm: 0 }],
    ],
    canceledAt: null,
    manuallyResolved: false,
    ...overrides,
  }
}

function rawReport(userId: SbUserId, victoryState: GameClientResult) {
  return {
    version: 2,
    time: 0,
    players: [{ userId, bwPlayerId: 0, stormId: 0, race: 'p', victoryState, alliances: [] }],
    netPlayers: [],
    localPlayerLoseType: null,
  }
}

/** A 1v1 the first player quit 30 seconds in, which the second then left from victory. */
function quitEvidence(quitter = QUITTER, winner = WINNER): GameUserDepartureEvidence[] {
  return [
    {
      userId: quitter,
      departureKind: 'left',
      departureTime: new Date(Number(START) + 50_000),
      relayReportFrame: 714,
      reportedResults: rawReport(quitter, GameClientResult.Playing) as any,
      result: 'loss',
    },
    {
      userId: winner,
      departureKind: 'left',
      departureTime: new Date(Number(START) + 53_000),
      relayReportFrame: 738,
      reportedResults: rawReport(winner, GameClientResult.Victory) as any,
      result: 'win',
    },
  ]
}

describe('matchmaking/early-leave-penalty-service', () => {
  let events: GameLifecycleEvents
  let matchmakingService: {
    takeStartedGameIdentifiers: ReturnType<typeof vi.fn>
    enforceGameBan: ReturnType<typeof vi.fn>
  }
  let banService: {
    applyGamePenalty: Mock<(userId: SbUserId, ...rest: unknown[]) => Promise<unknown>>
    acknowledgeGamePenaltyEnforced: ReturnType<typeof vi.fn>
  }
  let notificationService: { addNotification: ReturnType<typeof vi.fn> }
  let calls: string[]
  let service: EarlyLeavePenaltyService

  beforeEach(() => {
    vi.clearAllMocks()
    calls = []
    events = new GameLifecycleEvents({ now: () => 0 } as any)
    matchmakingService = {
      takeStartedGameIdentifiers: vi.fn().mockReturnValue(undefined),
      enforceGameBan: vi.fn(async (userId: SbUserId) => {
        calls.push(`enforce ${userId}`)
      }),
    }
    banService = {
      applyGamePenalty: vi.fn(async (userId: SbUserId) => {
        calls.push(`apply ${userId}`)
        return { penalty: 'lossAndBan', needsEnforcement: true, bannedUntil: 5_000 }
      }),
      acknowledgeGamePenaltyEnforced: vi.fn(async (_gameId: string, userId: SbUserId) => {
        calls.push(`acknowledge ${userId}`)
      }),
    }
    notificationService = {
      addNotification: vi.fn(async ({ userId }: { userId: SbUserId }) => {
        calls.push(`notify ${userId}`)
      }),
    }
    getGameRecord.mockResolvedValue(makeGame())
    getDepartureEvidenceForGame.mockResolvedValue(quitEvidence())

    service = new EarlyLeavePenaltyService(
      events,
      matchmakingService as any,
      banService as any,
      notificationService as any,
    )
  })

  test('bans, notifies, and enforces against a 1v1 quitter only', async () => {
    await service.penalizeEarlyLeavers(GAME_ID, new Map([[QUITTER, IDENTIFIERS]]))

    expect(banService.applyGamePenalty).toHaveBeenCalledExactlyOnceWith(
      QUITTER,
      IDENTIFIERS,
      GAME_ID,
      'leftEarly',
    )
    expect(notificationService.addNotification).toHaveBeenCalledExactlyOnceWith({
      userId: QUITTER,
      data: { type: NotificationType.MatchmakingBan, bannedUntil: 5_000, reason: 'leftEarly' },
    })
    expect(calls).toEqual([
      `apply ${QUITTER}`,
      `notify ${QUITTER}`,
      `enforce ${QUITTER}`,
      `acknowledge ${QUITTER}`,
    ])
  })

  test('only notifies a warning, which has no live state to change', async () => {
    banService.applyGamePenalty.mockResolvedValue({
      penalty: 'lossAndWarning',
      needsEnforcement: true,
    })

    await service.penalizeEarlyLeavers(GAME_ID)

    expect(notificationService.addNotification).toHaveBeenCalledExactlyOnceWith({
      userId: QUITTER,
      data: { type: NotificationType.MatchmakingBan, bannedUntil: undefined, reason: 'leftEarly' },
    })
    expect(matchmakingService.enforceGameBan).not.toHaveBeenCalled()
    expect(banService.acknowledgeGamePenaltyEnforced).toHaveBeenCalledWith(GAME_ID, QUITTER)
  })

  test('bans by account when the identifiers are no longer known', async () => {
    await service.penalizeEarlyLeavers(GAME_ID)

    expect(banService.applyGamePenalty).toHaveBeenCalledWith(QUITTER, [], GAME_ID, 'leftEarly')
  })

  test('leaves a penalty another caller is enforcing to it', async () => {
    banService.applyGamePenalty.mockResolvedValue({
      penalty: 'lossAndBan',
      needsEnforcement: false,
    })

    await service.penalizeEarlyLeavers(GAME_ID)

    expect(notificationService.addNotification).not.toHaveBeenCalled()
    expect(matchmakingService.enforceGameBan).not.toHaveBeenCalled()
    expect(banService.acknowledgeGamePenaltyEnforced).not.toHaveBeenCalled()
  })

  test.each([
    ['a custom game', { config: { ...makeGame().config, gameSource: GameSource.Lobby } }],
    ['a game without results', { results: null }],
    ['a disputed game', { disputable: true }],
    ['a lobby violation', { canceledAt: new Date(), cancellationReason: 'gameAnomaly' }],
    ['a manually resolved game', { manuallyResolved: true }],
  ])("doesn't judge %s", async (_name, overrides) => {
    getGameRecord.mockResolvedValue(makeGame(overrides))

    await service.penalizeEarlyLeavers(GAME_ID)

    expect(getDepartureEvidenceForGame).not.toHaveBeenCalled()
    expect(banService.applyGamePenalty).not.toHaveBeenCalled()
  })

  test('penalizes leavers one at a time, carrying on past a failure', async () => {
    const OTHER_QUITTER = makeSbUserId(3)
    const OTHER_WINNER = makeSbUserId(4)
    getGameRecord.mockResolvedValue(
      makeGame({
        config: {
          gameSource: GameSource.Matchmaking,
          teams: [
            [
              { id: QUITTER, race: 'p', isComputer: false },
              { id: OTHER_QUITTER, race: 'p', isComputer: false },
            ],
            [
              { id: WINNER, race: 'z', isComputer: false },
              { id: OTHER_WINNER, race: 'z', isComputer: false },
            ],
          ],
        },
      }),
    )
    // The first on each team quits early while the other team is still playing
    const first = quitEvidence(QUITTER, OTHER_WINNER)
    const second = quitEvidence(WINNER, OTHER_QUITTER).map(e => ({
      ...e,
      relayReportFrame: e.relayReportFrame! + 100,
    }))
    second[0].result = 'win'
    second[1].result = 'loss'
    second[1].reportedResults = rawReport(OTHER_QUITTER, GameClientResult.Defeat) as any
    getDepartureEvidenceForGame.mockResolvedValue([...first, ...second])

    let releaseFirst!: () => void
    const firstReleased = new Promise<void>(resolve => (releaseFirst = resolve))
    banService.applyGamePenalty.mockImplementationOnce(async (userId: SbUserId) => {
      calls.push(`apply ${userId}`)
      await firstReleased
      throw new Error('ban failed')
    })

    const penalizing = service.penalizeEarlyLeavers(GAME_ID)
    await vi.waitFor(() => expect(calls).toEqual([`apply ${QUITTER}`]))
    releaseFirst()
    await penalizing

    expect(calls).toEqual([
      `apply ${QUITTER}`,
      `apply ${WINNER}`,
      `notify ${WINNER}`,
      `enforce ${WINNER}`,
      `acknowledge ${WINNER}`,
    ])
    expect(loggerError).toHaveBeenCalledTimes(1)
  })

  describe('on reconciliation', () => {
    test('takes the identifiers remembered for the game and uses them', async () => {
      matchmakingService.takeStartedGameIdentifiers.mockReturnValue(
        new Map([[QUITTER, IDENTIFIERS]]),
      )

      events.emit('gameReconciled', { gameId: GAME_ID })

      expect(matchmakingService.takeStartedGameIdentifiers).toHaveBeenCalledWith(GAME_ID)
      await vi.waitFor(() =>
        expect(banService.applyGamePenalty).toHaveBeenCalledWith(
          QUITTER,
          IDENTIFIERS,
          GAME_ID,
          'leftEarly',
        ),
      )
    })

    test("forgets a game's identifiers even when it isn't judged", async () => {
      getGameRecord.mockResolvedValue(makeGame({ disputable: true }))

      events.emit('gameReconciled', { gameId: GAME_ID })

      expect(matchmakingService.takeStartedGameIdentifiers).toHaveBeenCalledWith(GAME_ID)
      await vi.waitFor(() => expect(getGameRecord).toHaveBeenCalled())
      expect(banService.applyGamePenalty).not.toHaveBeenCalled()
    })

    test('logs a failure rather than throwing it into the emitter', async () => {
      getGameRecord.mockRejectedValue(new Error('db unavailable'))

      expect(() => events.emit('gameReconciled', { gameId: GAME_ID })).not.toThrow()
      await vi.waitFor(() => expect(loggerError).toHaveBeenCalledTimes(1))

      matchmakingService.takeStartedGameIdentifiers.mockImplementation(() => {
        throw new Error('broken')
      })
      expect(() => events.emit('gameReconciled', { gameId: GAME_ID })).not.toThrow()
      expect(loggerError).toHaveBeenCalledTimes(2)
    })
  })
})
