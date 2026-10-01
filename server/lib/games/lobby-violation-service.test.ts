import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const {
  container,
  stageLobbyViolationIntent,
  applyStagedLobbyViolationEffects,
  applyGamePenalty,
  enforceLobbyViolationPenalty,
  acknowledgeGamePenaltyEnforced,
  currentIdentifiers,
  claimPendingGameLobbyViolations,
  loggerError,
} = vi.hoisted(() => ({
  container: { resolve: vi.fn() },
  stageLobbyViolationIntent: vi.fn(),
  applyStagedLobbyViolationEffects: vi.fn(),
  applyGamePenalty: vi.fn(),
  enforceLobbyViolationPenalty: vi.fn(),
  acknowledgeGamePenaltyEnforced: vi.fn(),
  currentIdentifiers: vi.fn(),
  claimPendingGameLobbyViolations: vi.fn(),
  loggerError: vi.fn(),
}))

vi.mock('tsyringe', () => ({
  container,
  singleton: () => (target: unknown) => target,
  injectable: () => (target: unknown) => target,
  inject: () => () => {},
  delay: (next: unknown) => next,
}))
vi.mock('../logging/logger', () => ({ default: { error: loggerError } }))
vi.mock('../matchmaking/matchmaking-ban-service', () => ({ MatchmakingBanService: class {} }))
vi.mock('../matchmaking/matchmaking-service', () => ({ MatchmakingService: class {} }))
vi.mock('../models/game-lobby-violations', () => ({
  claimPendingGameLobbyViolations,
  MAX_RECOVERY_ATTEMPTS: 3,
}))
vi.mock('./game-result-service', () => ({ default: class {} }))

import { LobbyViolationService } from './lobby-violation-service'

const GAME_ID = '11111111-2222-4333-8444-555555555555'
const USER_ID = 7 as any
const DETECTED_AT = new Date(1_000)
const IDENTIFIERS = [[1, 'abcd']]

function makeDependencies() {
  return {
    stageLobbyViolationIntent,
    applyStagedLobbyViolationEffects,
    applyGamePenalty,
    enforceLobbyViolationPenalty,
    acknowledgeGamePenaltyEnforced,
    currentIdentifiers,
  }
}

function makeService() {
  return new LobbyViolationService(
    { scheduleImmediateJob: vi.fn() } as any,
    { now: () => 1_000 } as any,
  )
}

describe('games/lobby-violation-service', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    ;(LobbyViolationService as any).recoveryStarted = false
    container.resolve.mockReturnValue(makeDependencies())
    claimPendingGameLobbyViolations.mockResolvedValue([])
    currentIdentifiers.mockReturnValue(undefined)
  })

  afterEach(() => vi.useRealTimers())

  test('attempts staging at most three times after persistent failure', async () => {
    stageLobbyViolationIntent.mockRejectedValue(new Error('db unavailable'))
    const service = makeService()

    await expect(service.stage(GAME_ID, USER_ID, DETECTED_AT)).rejects.toThrow('db unavailable')
    await vi.advanceTimersByTimeAsync(5_000)
    await vi.advanceTimersByTimeAsync(5_000)
    await vi.advanceTimersByTimeAsync(5_000)

    expect(stageLobbyViolationIntent).toHaveBeenCalledTimes(3)
  })

  test('shares one blocked stage attempt and applies effects once after it resolves', async () => {
    let release!: (accepted: boolean) => void
    stageLobbyViolationIntent.mockReturnValue(new Promise(resolve => (release = resolve)))
    applyStagedLobbyViolationEffects.mockResolvedValue({ userId: USER_ID, applied: true })
    applyGamePenalty.mockResolvedValue({ penalty: 'lossAndWarning', needsEnforcement: false })
    const service = makeService()

    const first = service.stage(GAME_ID, USER_ID, DETECTED_AT)
    const second = service.stage(GAME_ID, USER_ID, DETECTED_AT)
    expect(stageLobbyViolationIntent).toHaveBeenCalledTimes(1)

    release(true)
    await expect(Promise.all([first, second])).resolves.toEqual([true, true])
    vi.runAllTicks()
    await Promise.resolve()

    expect(applyStagedLobbyViolationEffects).toHaveBeenCalledTimes(1)
    expect(applyGamePenalty).toHaveBeenCalledTimes(1)
  })

  test('returns accepted staging before blocked matchmaking enforcement completes', async () => {
    let releaseEnforcement!: () => void
    stageLobbyViolationIntent.mockResolvedValue(true)
    applyStagedLobbyViolationEffects.mockResolvedValue({ userId: USER_ID, applied: true })
    applyGamePenalty.mockResolvedValue({ penalty: 'lossAndBan', needsEnforcement: true })
    enforceLobbyViolationPenalty.mockReturnValue(
      new Promise<void>(resolve => (releaseEnforcement = resolve)),
    )
    const service = makeService()

    await expect(service.stage(GAME_ID, USER_ID, DETECTED_AT)).resolves.toBe(true)
    expect(enforceLobbyViolationPenalty).toHaveBeenCalledTimes(1)
    expect(acknowledgeGamePenaltyEnforced).not.toHaveBeenCalled()

    releaseEnforcement()
    vi.runAllTicks()
    await Promise.resolve()
    expect(acknowledgeGamePenaltyEnforced).toHaveBeenCalledWith(GAME_ID, USER_ID)
  })

  test('leaves a failed enforcement unacknowledged and retries it from durable recovery', async () => {
    applyStagedLobbyViolationEffects.mockResolvedValue({ userId: USER_ID, applied: false })
    applyGamePenalty
      .mockResolvedValueOnce({ penalty: 'lossAndBan', needsEnforcement: true })
      .mockResolvedValueOnce({ penalty: 'lossAndBan', needsEnforcement: true })
    enforceLobbyViolationPenalty.mockRejectedValueOnce(new Error('matchmaking unavailable'))
    claimPendingGameLobbyViolations.mockResolvedValue([
      { gameId: GAME_ID, userId: USER_ID, detectedAt: DETECTED_AT },
    ])
    const service = makeService()

    await expect(service.record(GAME_ID, USER_ID, DETECTED_AT)).rejects.toThrow(
      'matchmaking unavailable',
    )
    expect(acknowledgeGamePenaltyEnforced).not.toHaveBeenCalled()

    await service.recoverStagedViolations()
    expect(enforceLobbyViolationPenalty).toHaveBeenCalledTimes(2)
    expect(acknowledgeGamePenaltyEnforced).toHaveBeenCalledWith(GAME_ID, USER_ID)
  })

  test('retries a failed acknowledgement from durable recovery', async () => {
    stageLobbyViolationIntent.mockResolvedValue(true)
    applyStagedLobbyViolationEffects.mockResolvedValue({
      userId: USER_ID,
      identifiers: [],
      applied: false,
    })
    applyGamePenalty.mockResolvedValue({ penalty: 'lossAndBan', needsEnforcement: true })
    enforceLobbyViolationPenalty.mockResolvedValue(undefined)
    acknowledgeGamePenaltyEnforced.mockRejectedValueOnce(new Error('ack unavailable'))
    claimPendingGameLobbyViolations.mockResolvedValue([
      { gameId: GAME_ID, userId: USER_ID, detectedAt: DETECTED_AT, recoveryAttempts: 1 },
    ])
    const service = makeService()

    await expect(service.record(GAME_ID, USER_ID, DETECTED_AT)).rejects.toThrow('ack unavailable')
    await service.recoverStagedViolations()
    expect(acknowledgeGamePenaltyEnforced).toHaveBeenCalledTimes(2)
  })

  test('stages the identifiers the offender queued with and bans them', async () => {
    currentIdentifiers.mockReturnValue(IDENTIFIERS)
    stageLobbyViolationIntent.mockResolvedValue(true)
    applyStagedLobbyViolationEffects.mockResolvedValue({
      userId: USER_ID,
      identifiers: IDENTIFIERS,
      applied: true,
    })
    applyGamePenalty.mockResolvedValue({ penalty: 'lossAndWarning', needsEnforcement: false })
    const service = makeService()

    await service.record(GAME_ID, USER_ID, DETECTED_AT)

    expect(currentIdentifiers).toHaveBeenCalledWith(USER_ID)
    expect(stageLobbyViolationIntent).toHaveBeenCalledWith(
      GAME_ID,
      USER_ID,
      DETECTED_AT,
      IDENTIFIERS,
    )
    expect(applyGamePenalty).toHaveBeenCalledWith(USER_ID, IDENTIFIERS, GAME_ID)
  })

  test('stages an offender who has left matchmaking with no identifiers', async () => {
    stageLobbyViolationIntent.mockResolvedValue(false)
    const service = makeService()

    await service.stage(GAME_ID, USER_ID, DETECTED_AT)

    expect(stageLobbyViolationIntent).toHaveBeenCalledWith(GAME_ID, USER_ID, DETECTED_AT, [])
  })

  test('reports a violation for manual review on its last recovery attempt', async () => {
    applyStagedLobbyViolationEffects.mockRejectedValue(new Error('still broken'))
    claimPendingGameLobbyViolations.mockResolvedValue([
      { gameId: GAME_ID, userId: USER_ID, detectedAt: DETECTED_AT, recoveryAttempts: 3 },
    ])
    const service = makeService()

    await service.recoverStagedViolations()

    expect(loggerError).toHaveBeenCalledWith(
      expect.objectContaining({ gameId: GAME_ID }),
      expect.stringContaining('manual review'),
    )
  })

  test('does not apply effects or penalties when staging is rejected', async () => {
    stageLobbyViolationIntent.mockResolvedValue(false)
    const service = makeService()

    await expect(service.record(GAME_ID, USER_ID, DETECTED_AT)).resolves.toBeUndefined()
    expect(applyStagedLobbyViolationEffects).not.toHaveBeenCalled()
    expect(applyGamePenalty).not.toHaveBeenCalled()
  })

  test('overlapping scheduler ticks do not start another recovery batch', async () => {
    let release!: (rows: unknown[]) => void
    claimPendingGameLobbyViolations.mockReturnValueOnce(
      new Promise(resolve => {
        release = resolve
      }),
    )
    const service = makeService()
    const first = service.recoverStagedViolations()
    const second = service.recoverStagedViolations()
    expect(claimPendingGameLobbyViolations).toHaveBeenCalledTimes(1)
    release([])
    await Promise.all([first, second])
    await service.recoverStagedViolations()
    expect(claimPendingGameLobbyViolations).toHaveBeenCalledTimes(2)
  })

  test('boot-scheduled recovery resolves the service and runs a batch without new evidence', async () => {
    const scheduler = { scheduleImmediateJob: vi.fn() }
    const service = new LobbyViolationService(scheduler as any, { now: () => 1_000 } as any)
    container.resolve.mockImplementation(token =>
      token === LobbyViolationService ? service : makeDependencies(),
    )

    const callback = scheduler.scheduleImmediateJob.mock.calls[0][2]
    await callback()

    expect(container.resolve).toHaveBeenCalledWith(LobbyViolationService)
    expect(claimPendingGameLobbyViolations).toHaveBeenCalledWith(50, new Date(1_000))
  })
})
