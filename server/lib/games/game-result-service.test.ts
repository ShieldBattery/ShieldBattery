import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  GameConfigPlayer,
  GameSource,
  LobbyGameConfig,
  MatchmakingGameConfig,
} from '../../../common/games/configuration'
import { GameType } from '../../../common/games/game-type'
import { GameRecord } from '../../../common/games/games'
import {
  GameClientResult,
  GameResultErrorCode,
  ReconciledPlayerResult,
} from '../../../common/games/results'
import { makeSbMapId } from '../../../common/maps'
import { MatchmakingSeason, MatchmakingType, makeSeasonId } from '../../../common/matchmaking'
import { asMockedFunction } from '../../../common/testing/mocks'
import { SbUserId, makeSbUserId } from '../../../common/users/sb-user-id'
import { updateRankings } from '../ladder/rankings'
import { updateLeaderboards } from '../leagues/leaderboard'
import { getActiveLeaguesForUsers } from '../leagues/league-models'
import {
  DEFAULT_MATCHMAKING_RATING,
  MatchmakingRating,
  getMatchmakingRatingsWithLock,
  insertMatchmakingRatingChange,
  updateMatchmakingRating,
} from '../matchmaking/models'
import { getDesyncEventsForGame } from '../models/game-desync-events'
import {
  StoredResultReport,
  areAllHumansAccountedFor,
  getCurrentReportedResults,
  setUserReconciledResult,
} from '../models/games-users'
import { checkSessionsAlive, loadConfigFromEnv } from '../netcode-v2/netcode-v2-service'
import { FakeClock } from '../time/testing/fake-clock'
import { incrementUserStatsCount, makeCountKeys } from '../users/user-stats-model'
import {
  findFullyReportedUnreconciledGames,
  findKnownCompleteUnreconciledGames,
  findUnreconciledGames,
  findUnreconciledV2GamesForProbe,
  getGameRecord,
  lockGameAndCheckReconciled,
  lockGameForManualResolution,
  setManuallyResolvedResult,
  setReconciledResult,
} from './game-models'
import GameResultService, {
  SUBMIT_GAME_RESULTS_REQUEST_SCHEMA,
  getValidationTeams,
  haveAllRequiredReportersReported,
  isResultsExempt,
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
    lockGameAndCheckReconciled: vi.fn(),
    lockGameForManualResolution: vi.fn(),
    setManuallyResolvedResult: vi.fn(),
    setReconciledResult: vi.fn(),
  }
})

vi.mock('../matchmaking/models', async () => {
  const actual =
    await vi.importActual<typeof import('../matchmaking/models')>('../matchmaking/models')
  return {
    ...actual,
    getMatchmakingRatingsWithLock: vi.fn(),
    insertMatchmakingRatingChange: vi.fn(),
    updateMatchmakingRating: vi.fn(),
  }
})

vi.mock('../leagues/league-models', async () => {
  const actual = await vi.importActual<typeof import('../leagues/league-models')>(
    '../leagues/league-models',
  )
  return {
    ...actual,
    getActiveLeaguesForUsers: vi.fn(),
    insertLeagueUserChange: vi.fn(),
    updateLeagueUser: vi.fn(),
  }
})

vi.mock('../ladder/rankings', async () => {
  const actual = await vi.importActual<typeof import('../ladder/rankings')>('../ladder/rankings')
  return {
    ...actual,
    doFullRankingsUpdate: vi.fn(),
    updateRankings: vi.fn(),
  }
})

vi.mock('../leagues/leaderboard', async () => {
  const actual =
    await vi.importActual<typeof import('../leagues/leaderboard')>('../leagues/leaderboard')
  return {
    ...actual,
    updateLeaderboards: vi.fn(),
  }
})

vi.mock('../models/games-users', async () => {
  const actual =
    await vi.importActual<typeof import('../models/games-users')>('../models/games-users')
  return {
    ...actual,
    areAllHumansAccountedFor: vi.fn(),
    getCurrentReportedResults: vi.fn(),
    setUserReconciledResult: vi.fn(),
  }
})

vi.mock('../db/transaction', () => ({
  default: vi.fn(async (next: (client: any) => Promise<any>) => next({} as any)),
}))

vi.mock('../models/game-desync-events', async () => {
  const actual = await vi.importActual<typeof import('../models/game-desync-events')>(
    '../models/game-desync-events',
  )
  return {
    ...actual,
    getDesyncEventsForGame: vi.fn(),
  }
})

vi.mock('../users/user-stats-model', async () => {
  const actual = await vi.importActual<typeof import('../users/user-stats-model')>(
    '../users/user-stats-model',
  )
  return {
    ...actual,
    incrementUserStatsCount: vi.fn(),
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

describe('games/game-result-service/isResultsExempt', () => {
  test('is false for a config without resultsExempt set (legacy record)', () => {
    const config = lobbyConfig()
    expect(config.resultsExempt).toBeUndefined()

    expect(isResultsExempt(config)).toBe(false)
  })

  test('is true for a config with resultsExempt explicitly true', () => {
    const config = lobbyConfig({ resultsExempt: true })

    expect(isResultsExempt(config)).toBe(true)
  })

  test('is false for a config with resultsExempt explicitly false', () => {
    const config = lobbyConfig({ resultsExempt: false })

    expect(isResultsExempt(config)).toBe(false)
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
      manuallyResolved: false,
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

  test('no-ops for a results-exempt game (contains computer players)', async () => {
    const gameRecord = makeGameRecord({
      config: matchmakingConfig(DEFAULT_TEAMS, { useNetcodeV2: true, resultsExempt: true }),
    })
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
      manuallyResolved: false,
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

  test('no-ops for a results-exempt game (contains computer players)', async () => {
    const gameRecord = makeGameRecord({
      config: matchmakingConfig(DEFAULT_TEAMS, { resultsExempt: true }),
    })
    asMockedFunction(getGameRecord).mockResolvedValue(gameRecord)

    await service.forceReconcileGame(GAME_ID)

    expect(maybeReconcileResults).not.toHaveBeenCalled()
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

describe('SUBMIT_GAME_RESULTS_REQUEST_SCHEMA (raw v2 reports)', () => {
  const rawReport = (netPlayerCount: number) => ({
    version: 2,
    userId: makeSbUserId(1),
    resultCode: 'abc123',
    time: 60_000,
    players: [
      {
        userId: makeSbUserId(1),
        bwPlayerId: 0,
        // Players share the storm id space with observers, so a player's storm id can exceed 7
        stormId: 8,
        race: 'z',
        victoryState: 3,
        alliances: [1, 0, 0, 0, 0, 0, 0, 0],
      },
    ],
    netPlayers: Array.from({ length: netPlayerCount }, (_, stormId) => ({
      stormId,
      wasDropped: false,
      hasQuit: stormId > 0,
    })),
    localPlayerLoseType: null,
  })

  test('accepts a report covering the full 12-slot storm id space', () => {
    const { error } = SUBMIT_GAME_RESULTS_REQUEST_SCHEMA.validate(rawReport(12))
    expect(error).toBeUndefined()
  })

  test('rejects more net player rows than the storm id space holds', () => {
    const { error } = SUBMIT_GAME_RESULTS_REQUEST_SCHEMA.validate(rawReport(13))
    expect(error).toBeDefined()
  })
})

describe('games/game-result-service/GameResultService#maybeReconcileResults', () => {
  const GAME_ID = 'game-reconcile-1'

  let clock: FakeClock
  let service: GameResultService

  function makeLobbyGameRecord(): GameRecord {
    return {
      id: GAME_ID,
      startTime: new Date(0),
      mapId: makeSbMapId('1'),
      config: lobbyConfig({ lockedAlliances: true }),
      disputable: false,
      disputeRequested: false,
      disputeReviewed: false,
      gameLength: null,
      results: null,
      selectedMatchup: null,
      assignedMatchup: null,
      manuallyResolved: false,
    }
  }

  function legacyReport(reporter: SbUserId): StoredResultReport {
    return {
      kind: 'legacy',
      reporter,
      time: 60_000,
      playerResults: [
        [p1, { result: GameClientResult.Victory, race: 't', apm: 100 }],
        [p2, { result: GameClientResult.Defeat, race: 'z', apm: 100 }],
      ],
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
      { getSeasonForDate: vi.fn().mockResolvedValue([{ id: 1 }, undefined]) } as any,
      clock,
      {} as any,
    )
  })

  test('a stale snapshot cannot re-apply result side effects after a reconcile committed', async () => {
    // Simulates the DB state the games row lock serializes on: the first committed reconcile
    // flips it, and every later lock-and-check observes the committed value.
    let reconciledInDb = false
    asMockedFunction(lockGameAndCheckReconciled).mockImplementation(async () => reconciledInDb)
    asMockedFunction(setReconciledResult).mockImplementation(async () => {
      reconciledInDb = true
    })
    asMockedFunction(getCurrentReportedResults).mockResolvedValue([
      legacyReport(p1),
      legacyReport(p2),
    ])
    asMockedFunction(getDesyncEventsForGame).mockResolvedValue([])
    asMockedFunction(setUserReconciledResult).mockResolvedValue(undefined as any)
    asMockedFunction(incrementUserStatsCount).mockResolvedValue(undefined as any)

    // Two triggers (e.g. a result submission's fire-and-forget reconcile and the relay's
    // known-complete force-reconcile) each capture an unreconciled snapshot before either
    // transaction commits.
    const staleRecord = makeLobbyGameRecord()

    const first = await (service as any).maybeReconcileResults(staleRecord)
    expect(first).toBe(true)
    const statsCallsAfterFirst = asMockedFunction(incrementUserStatsCount).mock.calls.length
    expect(statsCallsAfterFirst).toBeGreaterThan(0)

    const second = await (service as any).maybeReconcileResults(staleRecord)
    expect(second).toBe(false)
    expect(asMockedFunction(incrementUserStatsCount).mock.calls.length).toBe(statsCallsAfterFirst)
  })
})

describe('games/game-result-service/GameResultService#resolveGameManually', () => {
  const GAME_ID = 'game-manual-1'
  const ADMIN_ID = makeSbUserId(99)
  const p4 = makeSbUserId(4)

  const SEASON: MatchmakingSeason = {
    id: makeSeasonId(1),
    name: 'Season 1',
    startDate: new Date(0),
    resetMmr: true,
  }

  /** The stored results a disputed 1v1 leaves behind: races and APM known, outcomes not. */
  const DISPUTED_1V1_RESULTS: Array<[SbUserId, ReconciledPlayerResult]> = [
    [p1, { result: 'unknown', race: 't', apm: 120 }],
    [p2, { result: 'unknown', race: 'z', apm: 80 }],
  ]

  const TEAM_TEAMS: GameConfigPlayer[][] = [
    [
      { id: p1, race: 't', isComputer: false },
      { id: p2, race: 'z', isComputer: false },
    ],
    [
      { id: p3, race: 'p', isComputer: false },
      { id: p4, race: 't', isComputer: false },
    ],
  ]

  const DISPUTED_2V2_RESULTS: Array<[SbUserId, ReconciledPlayerResult]> = [
    [p1, { result: 'unknown', race: 't', apm: 120 }],
    [p2, { result: 'unknown', race: 'z', apm: 80 }],
    [p3, { result: 'unknown', race: 'p', apm: 200 }],
    [p4, { result: 'unknown', race: 't', apm: 90 }],
  ]

  let clock: FakeClock
  let service: GameResultService
  let getSeasonForDate: ReturnType<typeof vi.fn>
  let publishReconciledGame: ReturnType<typeof vi.spyOn>

  function makeDisputedGame(overrides: Partial<GameRecord> = {}): GameRecord {
    return {
      id: GAME_ID,
      startTime: new Date(0),
      mapId: makeSbMapId('1'),
      config: lobbyConfig({ lockedAlliances: true }),
      disputable: true,
      disputeRequested: false,
      disputeReviewed: false,
      gameLength: 60_000,
      results: DISPUTED_1V1_RESULTS,
      selectedMatchup: null,
      assignedMatchup: null,
      manuallyResolved: false,
      ...overrides,
    }
  }

  function makeMmr(userId: SbUserId): MatchmakingRating {
    return {
      ...DEFAULT_MATCHMAKING_RATING,
      userId,
      matchmakingType: MatchmakingType.Match1v1,
      seasonId: SEASON.id,
    }
  }

  const resolve = (results: Array<{ userId: SbUserId; result: 'win' | 'loss' | 'draw' }>) =>
    service.resolveGameManually({ gameId: GAME_ID, results, resolvedBy: ADMIN_ID })

  beforeEach(() => {
    vi.clearAllMocks()

    clock = new FakeClock()
    clock.setCurrentTime(1_000_000)

    getSeasonForDate = vi.fn().mockResolvedValue([SEASON, undefined])
    service = new GameResultService(
      { on: vi.fn() } as any,
      { publish: vi.fn() } as any,
      { publish: vi.fn() } as any,
      { scheduleJob: vi.fn(), unscheduleJob: vi.fn() } as any,
      { getSeasonForDate } as any,
      clock,
      {} as any,
    )
    // Publishing is covered by the reconcile path's own callers; here we only care that a committed
    // resolution triggers it.
    publishReconciledGame = vi
      .spyOn(service as any, 'publishReconciledGame')
      .mockResolvedValue(undefined)

    asMockedFunction(getGameRecord).mockResolvedValue(makeDisputedGame())
    asMockedFunction(lockGameForManualResolution).mockResolvedValue({
      disputable: true,
      results: DISPUTED_1V1_RESULTS,
    })
    asMockedFunction(setManuallyResolvedResult).mockResolvedValue(undefined)
    asMockedFunction(setUserReconciledResult).mockResolvedValue(undefined as any)
    asMockedFunction(incrementUserStatsCount).mockResolvedValue(undefined as any)
    asMockedFunction(getActiveLeaguesForUsers).mockResolvedValue(new Map())
    asMockedFunction(insertMatchmakingRatingChange).mockResolvedValue(undefined as any)
    asMockedFunction(updateMatchmakingRating).mockResolvedValue(undefined as any)
    asMockedFunction(updateRankings).mockResolvedValue(undefined)
    asMockedFunction(updateLeaderboards).mockResolvedValue(undefined)
  })

  test('rewrites a custom game outcome, keeping each player race and apm', async () => {
    const resolved = makeDisputedGame({
      disputable: false,
      disputeReviewed: true,
      manuallyResolved: true,
    })
    asMockedFunction(getGameRecord)
      .mockResolvedValueOnce(makeDisputedGame())
      .mockResolvedValueOnce(resolved)

    const result = await resolve([
      { userId: p1, result: 'win' },
      { userId: p2, result: 'loss' },
    ])

    expect(setUserReconciledResult).toHaveBeenCalledWith(expect.anything(), p1, GAME_ID, {
      result: 'win',
      race: 't',
      apm: 120,
    })
    expect(setUserReconciledResult).toHaveBeenCalledWith(expect.anything(), p2, GAME_ID, {
      result: 'loss',
      race: 'z',
      apm: 80,
    })

    // The games row is rewritten by the manual-resolution write, not the reconcile one — so the
    // game keeps its length and assigned matchup.
    expect(setReconciledResult).not.toHaveBeenCalled()
    expect(setManuallyResolvedResult).toHaveBeenCalledWith(
      expect.anything(),
      GAME_ID,
      new Map([
        [p1, { result: 'win', race: 't', apm: 120 }],
        [p2, { result: 'loss', race: 'z', apm: 80 }],
      ]),
      ADMIN_ID,
      new Date(clock.now()),
    )

    // A custom game has no ratings at stake, but its win/loss counters (skipped while disputed) do
    // get applied now.
    for (const key of makeCountKeys('t', 't', 'win')) {
      expect(incrementUserStatsCount).toHaveBeenCalledWith(expect.anything(), p1, key)
    }
    for (const key of makeCountKeys('z', 'z', 'loss')) {
      expect(incrementUserStatsCount).toHaveBeenCalledWith(expect.anything(), p2, key)
    }
    expect(getMatchmakingRatingsWithLock).not.toHaveBeenCalled()
    expect(updateRankings).not.toHaveBeenCalled()

    expect(result.ratingsApplied).toBe(false)
    expect(result.game).toEqual(resolved)
    expect(publishReconciledGame).toHaveBeenCalledWith(GAME_ID)
  })

  test('applies rating, points and ranking changes for a 1v1 matchmaking game', async () => {
    asMockedFunction(getGameRecord).mockResolvedValue(
      makeDisputedGame({ config: matchmakingConfig(DEFAULT_TEAMS) }),
    )
    asMockedFunction(getMatchmakingRatingsWithLock).mockResolvedValue([makeMmr(p1), makeMmr(p2)])

    const result = await resolve([
      { userId: p1, result: 'win' },
      { userId: p2, result: 'loss' },
    ])

    expect(getMatchmakingRatingsWithLock).toHaveBeenCalledWith(
      expect.anything(),
      [p1, p2],
      MatchmakingType.Match1v1,
      SEASON.id,
    )

    expect(insertMatchmakingRatingChange).toHaveBeenCalledTimes(2)
    expect(insertMatchmakingRatingChange).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ userId: p1, gameId: GAME_ID, outcome: 'win' }),
    )
    expect(insertMatchmakingRatingChange).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ userId: p2, gameId: GAME_ID, outcome: 'loss' }),
    )

    const updatedRatings = asMockedFunction(updateMatchmakingRating).mock.calls.map(
      ([, mmr]) => mmr,
    )
    const winner = updatedRatings.find(mmr => mmr.userId === p1)!
    const loser = updatedRatings.find(mmr => mmr.userId === p2)!
    expect(winner.rating).toBeGreaterThan(DEFAULT_MATCHMAKING_RATING.rating)
    expect(winner.wins).toBe(1)
    expect(winner.tWins).toBe(1)
    expect(loser.rating).toBeLessThan(DEFAULT_MATCHMAKING_RATING.rating)
    expect(loser.losses).toBe(1)
    expect(loser.zLosses).toBe(1)

    expect(updateRankings).toHaveBeenCalledWith(expect.anything(), [winner, loser])
    expect(result.ratingsApplied).toBe(true)
  })

  test('records the resolution without rating changes once the season is finalized', async () => {
    clock.setCurrentTime(100_000_000)
    getSeasonForDate.mockResolvedValue([SEASON, new Date(0)])
    asMockedFunction(getGameRecord).mockResolvedValue(
      makeDisputedGame({ config: matchmakingConfig(DEFAULT_TEAMS) }),
    )

    const result = await resolve([
      { userId: p1, result: 'win' },
      { userId: p2, result: 'loss' },
    ])

    expect(getMatchmakingRatingsWithLock).not.toHaveBeenCalled()
    expect(updateRankings).not.toHaveBeenCalled()
    expect(setManuallyResolvedResult).toHaveBeenCalled()
    expect(result.ratingsApplied).toBe(false)
  })

  test('throws NotFound when the game does not exist', async () => {
    asMockedFunction(getGameRecord).mockResolvedValue(undefined)

    await expect(
      resolve([
        { userId: p1, result: 'win' },
        { userId: p2, result: 'loss' },
      ]),
    ).rejects.toMatchObject({ code: GameResultErrorCode.NotFound })
    expect(lockGameForManualResolution).not.toHaveBeenCalled()
  })

  test('throws NotDisputable for a game that was never disputed or is already resolved', async () => {
    asMockedFunction(lockGameForManualResolution).mockResolvedValue({
      disputable: false,
      results: DISPUTED_1V1_RESULTS,
    })

    await expect(
      resolve([
        { userId: p1, result: 'win' },
        { userId: p2, result: 'loss' },
      ]),
    ).rejects.toMatchObject({ code: GameResultErrorCode.NotDisputable })
    expect(setManuallyResolvedResult).not.toHaveBeenCalled()
    expect(setUserReconciledResult).not.toHaveBeenCalled()
  })

  test('throws NotDisputable for a game with no reconciled results at all', async () => {
    asMockedFunction(lockGameForManualResolution).mockResolvedValue({
      disputable: true,
      results: null,
    })

    await expect(
      resolve([
        { userId: p1, result: 'win' },
        { userId: p2, result: 'loss' },
      ]),
    ).rejects.toMatchObject({ code: GameResultErrorCode.NotDisputable })
  })

  test('throws NotDisputable when the game row is gone', async () => {
    asMockedFunction(lockGameForManualResolution).mockResolvedValue(undefined)

    await expect(
      resolve([
        { userId: p1, result: 'win' },
        { userId: p2, result: 'loss' },
      ]),
    ).rejects.toMatchObject({ code: GameResultErrorCode.NotDisputable })
  })

  test('throws InvalidPlayers when the submitted players do not match the stored ones', async () => {
    await expect(resolve([{ userId: p1, result: 'win' }])).rejects.toMatchObject({
      code: GameResultErrorCode.InvalidPlayers,
    })

    await expect(
      resolve([
        { userId: p1, result: 'win' },
        { userId: p3, result: 'loss' },
      ]),
    ).rejects.toMatchObject({ code: GameResultErrorCode.InvalidPlayers })

    expect(setManuallyResolvedResult).not.toHaveBeenCalled()
  })

  test('throws InvalidResults for an outcome that is not a win, loss or draw', async () => {
    await expect(
      resolve([
        { userId: p1, result: 'unknown' as any },
        { userId: p2, result: 'loss' },
      ]),
    ).rejects.toMatchObject({ code: GameResultErrorCode.InvalidResults })
    expect(setManuallyResolvedResult).not.toHaveBeenCalled()
  })

  test('throws InvalidResults for a draw in a matchmaking game', async () => {
    asMockedFunction(getGameRecord).mockResolvedValue(
      makeDisputedGame({ config: matchmakingConfig(DEFAULT_TEAMS) }),
    )

    await expect(
      resolve([
        { userId: p1, result: 'draw' },
        { userId: p2, result: 'draw' },
      ]),
    ).rejects.toMatchObject({ code: GameResultErrorCode.InvalidResults })
    expect(setManuallyResolvedResult).not.toHaveBeenCalled()
  })

  test('throws InvalidResults when a matchmaking game has more than one winner in 1v1', async () => {
    asMockedFunction(getGameRecord).mockResolvedValue(
      makeDisputedGame({ config: matchmakingConfig(DEFAULT_TEAMS) }),
    )

    await expect(
      resolve([
        { userId: p1, result: 'win' },
        { userId: p2, result: 'win' },
      ]),
    ).rejects.toMatchObject({ code: GameResultErrorCode.InvalidResults })
  })

  test('throws InvalidResults when matchmaking winners span two teams', async () => {
    asMockedFunction(getGameRecord).mockResolvedValue(
      makeDisputedGame({
        config: matchmakingConfig(TEAM_TEAMS, {
          gameSourceExtra: { type: MatchmakingType.Match2v2, parties: [] },
          gameType: GameType.TopVsBottom,
          gameSubType: 2,
        }),
        results: DISPUTED_2V2_RESULTS,
      }),
    )
    asMockedFunction(lockGameForManualResolution).mockResolvedValue({
      disputable: true,
      results: DISPUTED_2V2_RESULTS,
    })

    await expect(
      resolve([
        { userId: p1, result: 'win' },
        { userId: p2, result: 'loss' },
        { userId: p3, result: 'win' },
        { userId: p4, result: 'loss' },
      ]),
    ).rejects.toMatchObject({ code: GameResultErrorCode.InvalidResults })
    expect(setManuallyResolvedResult).not.toHaveBeenCalled()
  })
})
