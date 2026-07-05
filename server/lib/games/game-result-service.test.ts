import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  GameConfigPlayer,
  GameSource,
  LobbyGameConfig,
  MatchmakingGameConfig,
} from '../../../common/games/configuration'
import { GameType } from '../../../common/games/game-type'
import { GameRecord } from '../../../common/games/games'
import { makeSbMapId } from '../../../common/maps'
import { MatchmakingType } from '../../../common/matchmaking'
import { asMockedFunction } from '../../../common/testing/mocks'
import { makeSbUserId } from '../../../common/users/sb-user-id'
import { areAllHumansAccountedFor } from '../models/games-users'
import { checkSessionsAlive, loadConfigFromEnv } from '../netcode-v2/netcode-v2-service'
import { FakeClock } from '../time/testing/fake-clock'
import {
  findFullyReportedUnreconciledGames,
  findKnownCompleteUnreconciledGames,
  findUnreconciledGames,
  findUnreconciledV2GamesForProbe,
  getGameRecord,
} from './game-models'
import GameResultService, {
  getValidationTeams,
  haveAllRequiredReportersReported,
  usedNetcodeV2,
} from './game-result-service'

vi.mock('./game-models', async () => {
  const actual = await vi.importActual<typeof import('./game-models')>('./game-models')
  return {
    ...actual,
    getGameRecord: vi.fn(),
    findUnreconciledGames: vi.fn(),
    findFullyReportedUnreconciledGames: vi.fn(),
    findKnownCompleteUnreconciledGames: vi.fn(),
    findUnreconciledV2GamesForProbe: vi.fn(),
  }
})

vi.mock('../models/games-users', async () => {
  const actual =
    await vi.importActual<typeof import('../models/games-users')>('../models/games-users')
  return {
    ...actual,
    areAllHumansAccountedFor: vi.fn(),
  }
})

vi.mock('../netcode-v2/netcode-v2-service', async () => {
  const actual = await vi.importActual<typeof import('../netcode-v2/netcode-v2-service')>(
    '../netcode-v2/netcode-v2-service',
  )
  return {
    ...actual,
    checkSessionsAlive: vi.fn(),
    loadConfigFromEnv: vi.fn(),
  }
})

const p1 = makeSbUserId(1)
const p2 = makeSbUserId(2)
const p3 = makeSbUserId(3)
const humans = [p1, p2]

function matchmakingConfig(
  teams: GameConfigPlayer[][],
  overrides: Partial<MatchmakingGameConfig> = {},
): MatchmakingGameConfig {
  return {
    gameSource: GameSource.Matchmaking,
    gameSourceExtra: { type: MatchmakingType.Match1v1 },
    gameType: GameType.OneVsOne,
    gameSubType: 0,
    teams,
    ...overrides,
  }
}

function lobbyConfig(overrides: Partial<LobbyGameConfig> = {}): LobbyGameConfig {
  return {
    gameSource: GameSource.Lobby,
    gameType: GameType.Melee,
    gameSubType: 0,
    teams: DEFAULT_TEAMS,
    ...overrides,
  }
}

const DEFAULT_TEAMS: GameConfigPlayer[][] = [
  [{ id: p1, race: 't', isComputer: false }],
  [{ id: p2, race: 'z', isComputer: false }],
]

describe('games/game-result-service/getValidationTeams', () => {
  test('validates teams for a matchmaking config without lockedAlliances (legacy record)', () => {
    const config = matchmakingConfig(DEFAULT_TEAMS)
    expect(config.lockedAlliances).toBeUndefined()

    expect(getValidationTeams(config, humans)).toEqual([[p1], [p2]])
  })

  test('validates teams for a matchmaking config with lockedAlliances explicitly true', () => {
    const config = matchmakingConfig(DEFAULT_TEAMS, { lockedAlliances: true })

    expect(getValidationTeams(config, humans)).toEqual([[p1], [p2]])
  })

  test('validates teams for a lobby config with lockedAlliances: true', () => {
    const config = lobbyConfig({ lockedAlliances: true })

    expect(getValidationTeams(config, humans)).toEqual([[p1], [p2]])
  })

  test('does not validate teams for a lobby config without lockedAlliances', () => {
    const config = lobbyConfig()
    expect(config.lockedAlliances).toBeUndefined()

    expect(getValidationTeams(config, humans)).toBe(null)
  })

  test('does not validate teams for a lobby config with lockedAlliances: false', () => {
    const config = lobbyConfig({ lockedAlliances: false })

    expect(getValidationTeams(config, humans)).toBe(null)
  })

  test('falls back to one-player teams for a locked-alliance FFA melee with no determinable teams', () => {
    const config = matchmakingConfig([
      [
        { id: p1, race: 't', isComputer: false },
        { id: p2, race: 'z', isComputer: false },
        { id: p3, race: 'p', isComputer: false },
      ],
    ])

    expect(getValidationTeams(config, [p1, p2, p3])).toEqual([[p1], [p2], [p3]])
  })
})

describe('games/game-result-service/usedNetcodeV2', () => {
  test('is false for a config without useNetcodeV2 set (legacy record)', () => {
    const config = matchmakingConfig(DEFAULT_TEAMS)
    expect(config.useNetcodeV2).toBeUndefined()

    expect(usedNetcodeV2(config)).toBe(false)
  })

  test('is true for a config with useNetcodeV2 explicitly true', () => {
    const config = matchmakingConfig(DEFAULT_TEAMS, { useNetcodeV2: true })

    expect(usedNetcodeV2(config)).toBe(true)
  })

  test('is false for a config with useNetcodeV2 explicitly false', () => {
    const config = matchmakingConfig(DEFAULT_TEAMS, { useNetcodeV2: false })

    expect(usedNetcodeV2(config)).toBe(false)
  })
})

describe('games/game-result-service/haveAllRequiredReportersReported', () => {
  test('does NOT consider a 2v2 matchmaking game fully reported when a diverged player reported but a real (non-diverged) reporter is still missing', () => {
    // Regression test for the "count vs identity" bug: p4 is diverged, and its report alone used to
    // be able to satisfy the gate on p3's behalf (both being non-null reports, count-wise), even
    // though p3 (a required, non-diverged reporter) never reported anything.
    const p4 = makeSbUserId(4)
    const allHumans = [p1, p2, p3, p4]
    const diverged = new Set([p4])
    // p1, p2, and p4 (the diverged player) have reported; p3 (required, non-diverged) has not.
    const reported = new Set([p1, p2, p4])

    expect(haveAllRequiredReportersReported(allHumans, diverged, reported)).toBe(false)
  })

  test('considers the game fully reported once the missing non-diverged reporter (p3) reports', () => {
    const p4 = makeSbUserId(4)
    const allHumans = [p1, p2, p3, p4]
    const diverged = new Set([p4])
    // Now p3 has also reported; the diverged player p4 still isn't required.
    const reported = new Set([p1, p2, p3])

    expect(haveAllRequiredReportersReported(allHumans, diverged, reported)).toBe(true)
  })

  test('does not require a diverged player to report at all', () => {
    const p4 = makeSbUserId(4)
    const allHumans = [p1, p2, p3, p4]
    const diverged = new Set([p4])
    const reported = new Set([p1, p2, p3])

    expect(haveAllRequiredReportersReported(allHumans, diverged, reported)).toBe(true)
  })

  test('requires every human when there are no diverged players', () => {
    expect(haveAllRequiredReportersReported([p1, p2], new Set(), new Set([p1]))).toBe(false)
    expect(haveAllRequiredReportersReported([p1, p2], new Set(), new Set([p1, p2]))).toBe(true)
  })
})

describe('games/game-result-service/GameResultService#maybeScheduleKnownCompleteReconcile', () => {
  const GAME_ID = 'game-1'

  let clock: FakeClock
  let service: GameResultService
  let maybeReconcileResults: ReturnType<typeof vi.spyOn>
  let publishReconciledGame: ReturnType<typeof vi.spyOn>

  function makeGameRecord(overrides: Partial<GameRecord> = {}): GameRecord {
    return {
      id: GAME_ID,
      startTime: new Date(0),
      mapId: makeSbMapId('1'),
      config: matchmakingConfig(DEFAULT_TEAMS, { useNetcodeV2: true }),
      disputable: false,
      disputeRequested: false,
      disputeReviewed: false,
      gameLength: null,
      results: null,
      selectedMatchup: null,
      assignedMatchup: null,
      ...overrides,
    }
  }

  beforeEach(() => {
    vi.clearAllMocks()

    clock = new FakeClock()
    clock.setCurrentTime(1_000_000)

    service = new GameResultService(
      { on: vi.fn() } as any,
      { publish: vi.fn() } as any,
      { publish: vi.fn() } as any,
      { scheduleJob: vi.fn(), unscheduleJob: vi.fn() } as any,
      {} as any,
      clock,
      {} as any,
    )

    // `maybeReconcileResults` and `publishReconciledGame` are exercised by their own tests
    // elsewhere; here we only care that this method calls them (via `forceReconcileGame`) at the
    // right time with the right arguments, so we stub their bodies out.
    maybeReconcileResults = vi
      .spyOn(service as any, 'maybeReconcileResults')
      .mockResolvedValue(true)
    publishReconciledGame = vi
      .spyOn(service as any, 'publishReconciledGame')
      .mockResolvedValue(undefined)
  })

  test('force-reconciles immediately once every human is accounted for', async () => {
    const gameRecord = makeGameRecord()
    asMockedFunction(getGameRecord).mockResolvedValue(gameRecord)
    asMockedFunction(areAllHumansAccountedFor).mockResolvedValue(true)

    await service.maybeScheduleKnownCompleteReconcile(GAME_ID)

    expect(maybeReconcileResults).toHaveBeenCalledWith(gameRecord, true)
    expect(publishReconciledGame).toHaveBeenCalledWith(GAME_ID)
  })

  test('each call that passes the gate force-reconciles again — no dedup/delay to skip', async () => {
    const gameRecord = makeGameRecord()
    asMockedFunction(getGameRecord).mockResolvedValue(gameRecord)
    asMockedFunction(areAllHumansAccountedFor).mockResolvedValue(true)

    await service.maybeScheduleKnownCompleteReconcile(GAME_ID)
    expect(maybeReconcileResults).toHaveBeenCalledTimes(1)

    await service.maybeScheduleKnownCompleteReconcile(GAME_ID)
    expect(maybeReconcileResults).toHaveBeenCalledTimes(2)
  })

  test('no-ops for a game whose config never used netcode v2', async () => {
    const gameRecord = makeGameRecord({ config: matchmakingConfig(DEFAULT_TEAMS) })
    asMockedFunction(getGameRecord).mockResolvedValue(gameRecord)

    await service.maybeScheduleKnownCompleteReconcile(GAME_ID)

    expect(areAllHumansAccountedFor).not.toHaveBeenCalled()
    expect(maybeReconcileResults).not.toHaveBeenCalled()
  })

  test('no-ops for a game that already has reconciled results', async () => {
    const gameRecord = makeGameRecord({ results: [] })
    asMockedFunction(getGameRecord).mockResolvedValue(gameRecord)

    await service.maybeScheduleKnownCompleteReconcile(GAME_ID)

    expect(areAllHumansAccountedFor).not.toHaveBeenCalled()
    expect(maybeReconcileResults).not.toHaveBeenCalled()
  })

  test('no-ops when some human still has neither a report nor a departure', async () => {
    const gameRecord = makeGameRecord()
    asMockedFunction(getGameRecord).mockResolvedValue(gameRecord)
    asMockedFunction(areAllHumansAccountedFor).mockResolvedValue(false)

    await service.maybeScheduleKnownCompleteReconcile(GAME_ID)

    expect(maybeReconcileResults).not.toHaveBeenCalled()
  })

  test('resolves quietly (never throws) when the game cannot be found', async () => {
    asMockedFunction(getGameRecord).mockResolvedValue(undefined)

    await expect(service.maybeScheduleKnownCompleteReconcile(GAME_ID)).resolves.toBeUndefined()
    expect(maybeReconcileResults).not.toHaveBeenCalled()
  })

  test('resolves quietly (never throws) when checking eligibility fails unexpectedly', async () => {
    const gameRecord = makeGameRecord()
    asMockedFunction(getGameRecord).mockResolvedValue(gameRecord)
    asMockedFunction(areAllHumansAccountedFor).mockRejectedValue(new Error('db exploded'))

    await expect(service.maybeScheduleKnownCompleteReconcile(GAME_ID)).resolves.toBeUndefined()
    expect(maybeReconcileResults).not.toHaveBeenCalled()
  })
})

describe('games/game-result-service/GameResultService#forceReconcileGame', () => {
  const GAME_ID = 'game-1'

  let clock: FakeClock
  let service: GameResultService
  let maybeReconcileResults: ReturnType<typeof vi.spyOn>
  let publishReconciledGame: ReturnType<typeof vi.spyOn>

  function makeGameRecord(overrides: Partial<GameRecord> = {}): GameRecord {
    return {
      id: GAME_ID,
      startTime: new Date(0),
      mapId: makeSbMapId('1'),
      config: matchmakingConfig(DEFAULT_TEAMS, { useNetcodeV2: true }),
      disputable: false,
      disputeRequested: false,
      disputeReviewed: false,
      gameLength: null,
      results: null,
      selectedMatchup: null,
      assignedMatchup: null,
      ...overrides,
    }
  }

  beforeEach(() => {
    vi.clearAllMocks()

    clock = new FakeClock()
    clock.setCurrentTime(1_000_000)

    service = new GameResultService(
      { on: vi.fn() } as any,
      { publish: vi.fn() } as any,
      { publish: vi.fn() } as any,
      { scheduleJob: vi.fn(), unscheduleJob: vi.fn() } as any,
      {} as any,
      clock,
      {} as any,
    )

    maybeReconcileResults = vi.spyOn(service as any, 'maybeReconcileResults')
    publishReconciledGame = vi
      .spyOn(service as any, 'publishReconciledGame')
      .mockResolvedValue(undefined)
  })

  test('force-reconciles and publishes when reconciliation commits', async () => {
    const gameRecord = makeGameRecord()
    asMockedFunction(getGameRecord).mockResolvedValue(gameRecord)
    maybeReconcileResults.mockResolvedValue(true)

    await service.forceReconcileGame(GAME_ID)

    expect(maybeReconcileResults).toHaveBeenCalledWith(gameRecord, true)
    expect(publishReconciledGame).toHaveBeenCalledWith(GAME_ID)
  })

  test('does not publish when reconciliation does not commit', async () => {
    const gameRecord = makeGameRecord()
    asMockedFunction(getGameRecord).mockResolvedValue(gameRecord)
    maybeReconcileResults.mockResolvedValue(false)

    await service.forceReconcileGame(GAME_ID)

    expect(publishReconciledGame).not.toHaveBeenCalled()
  })

  test('resolves quietly (never throws) when the game cannot be found', async () => {
    asMockedFunction(getGameRecord).mockResolvedValue(undefined)

    await expect(service.forceReconcileGame(GAME_ID)).resolves.toBeUndefined()
    expect(publishReconciledGame).not.toHaveBeenCalled()
  })

  test('resolves quietly (never throws) when reconciliation fails unexpectedly', async () => {
    const gameRecord = makeGameRecord()
    asMockedFunction(getGameRecord).mockResolvedValue(gameRecord)
    maybeReconcileResults.mockRejectedValue(new Error('db exploded'))

    await expect(service.forceReconcileGame(GAME_ID)).resolves.toBeUndefined()
    expect(publishReconciledGame).not.toHaveBeenCalled()
  })
})

describe('games/game-result-service/GameResultService periodic sweep — netcode-v2 liveness probe', () => {
  const GAME_ID_ALIVE = 'game-alive'
  const GAME_ID_GONE = 'game-gone'

  const FAKE_CONFIG = {
    coordinatorUrl: 'http://coordinator.example',
    tenant: 'sb-dev',
    relayServerName: 'localhost',
  }

  let clock: FakeClock
  let service: GameResultService
  let forceReconcileGame: ReturnType<typeof vi.spyOn>
  let sweepCallback: () => Promise<void>

  beforeEach(() => {
    vi.clearAllMocks()

    clock = new FakeClock()
    clock.setCurrentTime(1_000_000)

    // The sweep also runs the legacy/known-complete loops before the probe; stub them out to
    // empty so this block only exercises the probe's own behavior.
    asMockedFunction(findUnreconciledGames).mockResolvedValue([])
    asMockedFunction(findFullyReportedUnreconciledGames).mockResolvedValue([])
    asMockedFunction(findKnownCompleteUnreconciledGames).mockResolvedValue([])
    asMockedFunction(findUnreconciledV2GamesForProbe).mockResolvedValue([])

    const jobScheduler = {
      scheduleJob: vi.fn(
        (_name: string, _start: Date, _interval: number, cb: () => Promise<void>) => {
          sweepCallback = cb
        },
      ),
      unscheduleJob: vi.fn(),
    }

    service = new GameResultService(
      { on: vi.fn() } as any,
      { publish: vi.fn() } as any,
      { publish: vi.fn() } as any,
      jobScheduler as any,
      {} as any,
      clock,
      {} as any,
    )

    forceReconcileGame = vi.spyOn(service, 'forceReconcileGame').mockResolvedValue(undefined)
  })

  test('skips the probe entirely when netcode v2 is not configured', async () => {
    asMockedFunction(loadConfigFromEnv).mockReturnValue(undefined)

    await sweepCallback()

    expect(findUnreconciledV2GamesForProbe).not.toHaveBeenCalled()
    expect(checkSessionsAlive).not.toHaveBeenCalled()
  })

  test('does not call the coordinator when there are no probe candidates', async () => {
    asMockedFunction(loadConfigFromEnv).mockReturnValue(FAKE_CONFIG)
    asMockedFunction(findUnreconciledV2GamesForProbe).mockResolvedValue([])

    await sweepCallback()

    expect(checkSessionsAlive).not.toHaveBeenCalled()
    expect(forceReconcileGame).not.toHaveBeenCalled()
  })

  test('force-reconciles games whose session is gone/unknown, skips ones still alive', async () => {
    asMockedFunction(loadConfigFromEnv).mockReturnValue(FAKE_CONFIG)
    asMockedFunction(findUnreconciledV2GamesForProbe).mockResolvedValue([
      { gameId: GAME_ID_ALIVE, session: 1 },
      { gameId: GAME_ID_GONE, session: 2 },
    ])
    asMockedFunction(checkSessionsAlive).mockResolvedValue(new Set([1]))

    await sweepCallback()

    expect(checkSessionsAlive).toHaveBeenCalledWith([1, 2])
    expect(forceReconcileGame).toHaveBeenCalledTimes(1)
    expect(forceReconcileGame).toHaveBeenCalledWith(GAME_ID_GONE)
  })

  test('logs and continues (does not throw) if the coordinator liveness check fails', async () => {
    asMockedFunction(loadConfigFromEnv).mockReturnValue(FAKE_CONFIG)
    asMockedFunction(findUnreconciledV2GamesForProbe).mockResolvedValue([
      { gameId: GAME_ID_GONE, session: 2 },
    ])
    asMockedFunction(checkSessionsAlive).mockRejectedValue(new Error('coordinator down'))

    await expect(sweepCallback()).resolves.toBeUndefined()
    expect(forceReconcileGame).not.toHaveBeenCalled()
  })
})
