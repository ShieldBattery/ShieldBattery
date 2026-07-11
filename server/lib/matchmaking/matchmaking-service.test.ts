import { register } from 'prom-client'
import { Result } from 'typescript-result'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  GameServerRegionId,
  makeGameServerRegionId,
} from '../../../common/game-server-regions'
import { makeSbMapId, SbMapId } from '../../../common/maps'
import {
  MatchmakingCompletionType,
  MatchmakingPreferences,
  MatchmakingType,
} from '../../../common/matchmaking'
import { asMockedFunction } from '../../../common/testing/mocks'
import { MatchFoundMessage } from '../../../common/typeshare'
import { makeSbUserId, SbUserId } from '../../../common/users/sb-user-id'
import { BaseGameLoaderError, GameLoadErrorType } from '../games/game-loader'
import { GameplayActivityRegistry } from '../games/gameplay-activity-registry'
import { FakeClock } from '../time/testing/fake-clock'
import { ClientSocketsGroup } from '../websockets/socket-groups'
import { TypedPublisher } from '../websockets/typed-publisher'
import {
  rsCancelPlayer,
  RsClientErrorCode,
  rsGetProcessToken,
  RsMatchmakerError,
  RsMatchmakerErrorCode,
  rsQueuePlayer,
  rsRequeuePlayer,
} from './matchmaker-rs-client'
import { MatchmakingService } from './matchmaking-service'
import { getMatchmakingUserPath } from './matchmaking-socket-paths'

// We only mock the network functions of the Rust client; the error type and codes stay real so the
// service's `code` checks behave like production.
vi.mock('./matchmaker-rs-client', async () => {
  const actual =
    await vi.importActual<typeof import('./matchmaker-rs-client')>('./matchmaker-rs-client')
  return {
    ...actual,
    rsQueuePlayer: vi.fn(),
    rsCancelPlayer: vi.fn(),
    rsGetProcessToken: vi.fn(),
    rsRequeuePlayer: vi.fn(),
  }
})

vi.mock('./models', () => ({
  getMatchmakingRating: vi.fn(),
  createInitialMatchmakingRating: vi.fn(),
  insertMatchmakingCompletion: vi.fn().mockResolvedValue(undefined),
  insertMatchmakingMatchFormation: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('./matchmaking-map-pools-models', async () => ({
  ...(await vi.importActual<any>('./matchmaking-map-pools-models')),
  getCurrentMapPool: vi.fn(),
}))

vi.mock('../maps/map-models', async () => ({
  ...(await vi.importActual<any>('../maps/map-models')),
  getMapInfos: vi.fn(),
}))

import { getMapInfos } from '../maps/map-models'
import { getCurrentMapPool } from './matchmaking-map-pools-models'
import {
  getMatchmakingRating,
  insertMatchmakingCompletion,
  insertMatchmakingMatchFormation,
} from './models'

const MAP_ID: SbMapId = makeSbMapId('1')
const SEASON = { id: 1, startDate: new Date(0), name: 'test', resetMmr: false } as any

const USER_A = makeSbUserId(1)
const USER_B = makeSbUserId(2)
const CLIENT_A = 'CLIENT_A'
const CLIENT_B = 'CLIENT_B'
const GAME_ID = 'game-1'
const REGION_US_EAST: GameServerRegionId = makeGameServerRegionId('us-east')

function makePreferences(): MatchmakingPreferences {
  return {
    userId: USER_A,
    matchmakingType: MatchmakingType.Match1v1,
    race: 'p',
    mapPoolId: 1,
    mapSelections: [MAP_ID],
    data: { useAlternateRace: false, alternateRace: 'z' },
  } as unknown as MatchmakingPreferences
}

function makeMmr(userId: SbUserId) {
  return {
    userId,
    matchmakingType: MatchmakingType.Match1v1,
    seasonId: SEASON.id,
    rating: 1500,
    uncertainty: 200,
    volatility: 0.06,
    points: 0,
    pointsConverged: true,
    bonusUsed: 0,
    numGamesPlayed: 10,
    lifetimeGames: 10,
    lastPlayedDate: new Date(1_000_000),
    wins: 0,
    losses: 0,
  } as any
}

describe('matchmaking/matchmaking-service', () => {
  let service: MatchmakingService
  let publisher: { publish: ReturnType<typeof vi.fn> }
  let activityRegistry: GameplayActivityRegistry
  let banUser: ReturnType<typeof vi.fn>
  let clientSockets: Map<SbUserId, ClientSocketsGroup>
  let gameLoader: { loadGame: ReturnType<typeof vi.fn> }
  let gameServerRegionsService: {
    getRegions: ReturnType<typeof vi.fn>
  }
  let redisHandler: (event: { type: 'matchFound'; data: MatchFoundMessage }) => void

  function createFakeClient(userId: SbUserId, clientId: string): ClientSocketsGroup {
    return {
      userId,
      clientId,
      clientType: 'electron',
      isConnected: () => true,
      subscribe: vi.fn(),
      unsubscribe: vi.fn(),
    } as unknown as ClientSocketsGroup
  }

  function errorPublishedFor(userId: SbUserId): boolean {
    return publisher.publish.mock.calls.some(
      (call: any[]) =>
        call[0] === getMatchmakingUserPath(userId) && call[1]?.type === 'matchmakingServiceError',
    )
  }

  async function queuePlayer(
    userId: SbUserId,
    clientId: string,
    desiredRegion?: { region?: GameServerRegionId; rttMs?: number },
  ) {
    const prefs = makePreferences()
    prefs.matchmakingType = MatchmakingType.Match1v1
    ;(prefs as any).userId = userId
    await service.find(userId, clientId, [], [prefs], desiredRegion)
  }

  async function queueMultiPlayer(
    userId: SbUserId,
    clientId: string,
    types: MatchmakingType[],
  ): Promise<void> {
    const allPrefs = types.map(type => {
      const prefs = makePreferences()
      prefs.matchmakingType = type
      ;(prefs as any).userId = userId
      return prefs
    })
    await service.find(userId, clientId, [], allPrefs)
  }

  function completionsFor(userId: SbUserId, completionType: MatchmakingCompletionType) {
    return asMockedFunction(insertMatchmakingCompletion)
      .mock.calls.map(call => call[0])
      .filter(c => c.userId === userId && c.completionType === completionType)
  }

  beforeEach(() => {
    vi.clearAllMocks()
    register.clear()
    vi.useFakeTimers()

    const clock = new FakeClock()
    clock.setCurrentTime(1_000_000)

    publisher = { publish: vi.fn() }
    activityRegistry = new GameplayActivityRegistry()
    banUser = vi.fn().mockResolvedValue(undefined)
    clientSockets = new Map([
      [USER_A, createFakeClient(USER_A, CLIENT_A)],
      [USER_B, createFakeClient(USER_B, CLIENT_B)],
    ])
    // Defaults to a never-resolving load so tests that only exercise earlier phases (accept, etc.)
    // behave as before; tests that need a completed load override this with a resolved result.
    gameLoader = { loadGame: vi.fn().mockReturnValue(new Promise<never>(() => {})) }

    const userSocketsManager = { on: vi.fn(), getById: vi.fn() }
    const clientSocketsManager = {
      getById: vi.fn((userId: SbUserId, _clientId: string) => clientSockets.get(userId)),
    }
    const matchmakingStatus = { isEnabled: () => true }
    const matchmakingSeasonsService = { getCurrentSeason: vi.fn().mockResolvedValue(SEASON) }
    const userIdentifierManager = { findUsersWithIdentifiers: vi.fn().mockResolvedValue([]) }
    const matchmakingBanService = { banUser }
    const restrictionService = { isRestricted: vi.fn().mockResolvedValue(false) }
    const redisSubscriber = {
      subscribe: vi.fn(async (_channel: string, handler: any) => {
        redisHandler = handler
      }),
    }
    // Region list used to validate a queued player's desired region. Defaults to a single known
    // region so region-forwarding tests can submit a valid region; tests that submit no region never
    // reach this call.
    gameServerRegionsService = {
      getRegions: vi.fn().mockResolvedValue([{ id: REGION_US_EAST }]),
    }

    asMockedFunction(getMatchmakingRating).mockImplementation(async (userId: SbUserId) =>
      makeMmr(userId),
    )
    asMockedFunction(rsQueuePlayer).mockResolvedValue(Result.ok())
    asMockedFunction(rsCancelPlayer).mockResolvedValue(Result.ok())
    asMockedFunction(rsRequeuePlayer).mockResolvedValue(Result.ok())
    asMockedFunction(rsGetProcessToken).mockResolvedValue(Result.ok('token-1'))

    service = new MatchmakingService(
      publisher as unknown as TypedPublisher<any>,
      userSocketsManager as any,
      clientSocketsManager as any,
      matchmakingStatus as any,
      activityRegistry,
      gameLoader as any,
      matchmakingSeasonsService as any,
      clock,
      userIdentifierManager as any,
      matchmakingBanService as any,
      restrictionService as any,
      redisSubscriber as any,
      gameServerRegionsService as any,
    )
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  test('recovers from an orphaned Rust queue entry by canceling and retrying once', async () => {
    asMockedFunction(rsQueuePlayer)
      .mockResolvedValueOnce(
        Result.error(
          new RsMatchmakerError(
            RsMatchmakerErrorCode.AlreadyInQueue,
            'Player is already in the queue',
          ),
        ),
      )
      .mockResolvedValueOnce(Result.ok())

    await queuePlayer(USER_A, CLIENT_A)

    expect(rsCancelPlayer).toHaveBeenCalledWith(USER_A)
    expect(rsQueuePlayer).toHaveBeenCalledTimes(2)
    // Player ended up queued, so canceling them again succeeds rather than throwing NotInQueue.
    await expect(service.cancel(USER_A)).resolves.toBeUndefined()
  })

  test('cancels the Rust queue entry when the token fetch fails after a successful queue', async () => {
    // The queue starts idle, so the first queuer triggers a token fetch. If that fetch fails after
    // the player was already added to the Rust queue, we must cancel them rather than leave a ghost.
    asMockedFunction(rsGetProcessToken).mockResolvedValueOnce(
      Result.error(new RsMatchmakerError(RsClientErrorCode.ServiceUnavailable, 'boom')),
    )

    await expect(queuePlayer(USER_A, CLIENT_A)).rejects.toThrow('boom')

    expect(rsQueuePlayer).toHaveBeenCalled()
    expect(rsCancelPlayer).toHaveBeenCalledWith(USER_A)
  })

  test('an idle-period restart does not falsely kick the next queuer', async () => {
    // Player A queues, establishing the baseline token, then cancels — emptying the queue and
    // stopping the watchdog.
    await queuePlayer(USER_A, CLIENT_A)
    await service.cancel(USER_A)

    // Watchdog tick observes the empty queue and stops, clearing the stale token baseline.
    await vi.advanceTimersByTimeAsync(5000)

    // server-rs restarts while the queue is idle (new process token).
    asMockedFunction(rsGetProcessToken).mockResolvedValue(Result.ok('token-2'))

    // Player B queues against the new process and the watchdog re-baselines to token-2.
    await queuePlayer(USER_B, CLIENT_B)
    await vi.advanceTimersByTimeAsync(5000)

    expect(errorPublishedFor(USER_B)).toBe(false)
    // B is validly queued, so cancel works (would throw if they'd been ghosted/kicked).
    await expect(service.cancel(USER_B)).resolves.toBeUndefined()
  })

  test('tolerates a single transient token-fetch failure, ejecting only after two in a row', async () => {
    await queuePlayer(USER_A, CLIENT_A)

    asMockedFunction(rsGetProcessToken).mockResolvedValue(
      Result.error(new RsMatchmakerError(RsClientErrorCode.ServiceUnavailable, 'boom')),
    )

    // First failure: do not eject.
    await vi.advanceTimersByTimeAsync(5000)
    expect(errorPublishedFor(USER_A)).toBe(false)

    // Second consecutive failure: now treat it as a restart and eject.
    await vi.advanceTimersByTimeAsync(5000)
    expect(errorPublishedFor(USER_A)).toBe(true)
    // Best-effort cleanup of the (possibly still-present) Rust queue entry.
    expect(rsCancelPlayer).toHaveBeenCalledWith(USER_A)
  })

  test('a single failure followed by a success resets the failure counter', async () => {
    await queuePlayer(USER_A, CLIENT_A)

    asMockedFunction(rsGetProcessToken).mockResolvedValueOnce(
      Result.error(new RsMatchmakerError(RsClientErrorCode.ServiceUnavailable, 'boom')),
    )
    await vi.advanceTimersByTimeAsync(5000) // failure 1
    await vi.advanceTimersByTimeAsync(5000) // success, resets counter

    expect(errorPublishedFor(USER_A)).toBe(false)
  })

  test('requeues innocent players when a match is dropped due to missing player data', async () => {
    await queuePlayer(USER_A, CLIENT_A)
    await queuePlayer(USER_B, CLIENT_B)

    // B cancels in the window before the match event is processed, dropping their queue data.
    await service.cancel(USER_B)

    redisHandler({
      type: 'matchFound',
      data: {
        mode: MatchmakingType.Match1v1,
        teamA: [{ id: USER_A, ticket: 'ticket-a' }],
        teamB: [{ id: USER_B, ticket: 'ticket-b' }],
        quality: 1,
        skillVariance: 0,
        winProbability: 0.5,
        teamARating: 1500,
        teamBRating: 1500,
        maxLatency: 0,
      },
    })
    await vi.advanceTimersByTimeAsync(0)

    // A is innocent: they get requeued with their event ticket rather than ejected with an error.
    expect(rsRequeuePlayer).toHaveBeenCalledWith('ticket-a')
    expect(errorPublishedFor(USER_A)).toBe(false)
    // B cleanly canceled, so they must not get a spurious "matchmaking failed" error.
    expect(errorPublishedFor(USER_B)).toBe(false)
  })

  test('a restart while a match is forming does not kick or ban the matched players', async () => {
    asMockedFunction(getCurrentMapPool).mockResolvedValue({ maps: [MAP_ID] } as any)
    asMockedFunction(getMapInfos).mockResolvedValue([{ id: MAP_ID } as any])

    await queuePlayer(USER_A, CLIENT_A)
    await queuePlayer(USER_B, CLIENT_B)

    redisHandler({
      type: 'matchFound',
      data: {
        mode: MatchmakingType.Match1v1,
        teamA: [{ id: USER_A, ticket: 'ticket-a' }],
        teamB: [{ id: USER_B, ticket: 'ticket-b' }],
        quality: 1,
        skillVariance: 0,
        winProbability: 0.5,
        teamARating: 1500,
        teamBRating: 1500,
        maxLatency: 0,
      },
    })
    await vi.advanceTimersByTimeAsync(0)

    // Both players are now in a match (accept phase). server-rs restarts.
    asMockedFunction(rsGetProcessToken).mockResolvedValue(Result.ok('token-2'))
    asMockedFunction(rsCancelPlayer).mockClear()
    await vi.advanceTimersByTimeAsync(5000)

    // Matched players must not be ejected, error-notified, or banned by restart handling.
    expect(errorPublishedFor(USER_A)).toBe(false)
    expect(errorPublishedFor(USER_B)).toBe(false)
    expect(banUser).not.toHaveBeenCalled()
    expect(rsCancelPlayer).not.toHaveBeenCalled()
  })

  test('records the match formation telemetry keyed by the loaded game id', async () => {
    asMockedFunction(getCurrentMapPool).mockResolvedValue({ maps: [MAP_ID] } as any)
    asMockedFunction(getMapInfos).mockResolvedValue([{ id: MAP_ID } as any])
    gameLoader.loadGame.mockResolvedValue(Result.ok({ gameId: GAME_ID }))

    await queuePlayer(USER_A, CLIENT_A)
    await queuePlayer(USER_B, CLIENT_B)

    redisHandler({
      type: 'matchFound',
      data: {
        mode: MatchmakingType.Match1v1,
        teamA: [{ id: USER_A, ticket: 'ticket-a' }],
        teamB: [{ id: USER_B, ticket: 'ticket-b' }],
        quality: 12.5,
        skillVariance: 30000,
        winProbability: 0.42,
        teamARating: 1500,
        teamBRating: 1600,
        maxLatency: 1,
      },
    })
    await vi.advanceTimersByTimeAsync(0)

    // Both players accept, so the match runs through map selection and a successful game load.
    await service.accept(USER_A)
    await service.accept(USER_B)
    // Drain the runMatch promise chain (accept -> pickMap -> draft -> doGameLoad -> loadGame).
    for (let i = 0; i < 20; i++) {
      await vi.advanceTimersByTimeAsync(0)
    }

    // The matchmaker's formation decision is persisted exactly once, keyed by the game it produced
    // and carrying the quality breakdown from the matchFound event verbatim.
    expect(insertMatchmakingMatchFormation).toHaveBeenCalledTimes(1)
    expect(insertMatchmakingMatchFormation).toHaveBeenCalledWith({
      gameId: GAME_ID,
      matchmakingType: MatchmakingType.Match1v1,
      quality: 12.5,
      skillVariance: 30000,
      winProbability: 0.42,
      teamARating: 1500,
      teamBRating: 1600,
      maxLatency: 1,
    })
  })

  test('records the match formation telemetry for a match that fails to start', async () => {
    asMockedFunction(getCurrentMapPool).mockResolvedValue({ maps: [MAP_ID] } as any)
    asMockedFunction(getMapInfos).mockResolvedValue([{ id: MAP_ID } as any])
    // The game fails to load, so the match falls apart in the 'loading' phase.
    gameLoader.loadGame.mockResolvedValue(
      Result.error(new BaseGameLoaderError(GameLoadErrorType.Internal, 'game load failed')),
    )

    await queuePlayer(USER_A, CLIENT_A)
    await queuePlayer(USER_B, CLIENT_B)

    redisHandler({
      type: 'matchFound',
      data: {
        mode: MatchmakingType.Match1v1,
        teamA: [{ id: USER_A, ticket: 'ticket-a' }],
        teamB: [{ id: USER_B, ticket: 'ticket-b' }],
        quality: 12.5,
        skillVariance: 30000,
        winProbability: 0.42,
        teamARating: 1500,
        teamBRating: 1600,
        maxLatency: 1,
      },
    })
    await vi.advanceTimersByTimeAsync(0)

    // Both players accept; the match then runs through to the (failing) game load.
    await service.accept(USER_A)
    await service.accept(USER_B)
    for (let i = 0; i < 20; i++) {
      await vi.advanceTimersByTimeAsync(0)
    }

    // The failed match's formation decision is persisted exactly once, keyed by the phase it fell
    // apart in (no game id) and carrying the same quality breakdown a launched match would.
    expect(insertMatchmakingMatchFormation).toHaveBeenCalledTimes(1)
    expect(insertMatchmakingMatchFormation).toHaveBeenCalledWith({
      failPhase: 'loading',
      matchmakingType: MatchmakingType.Match1v1,
      quality: 12.5,
      skillVariance: 30000,
      winProbability: 0.42,
      teamARating: 1500,
      teamBRating: 1600,
      maxLatency: 1,
    })
  })

  test('counts a found match once, not once per matched player', async () => {
    await queuePlayer(USER_A, CLIENT_A)
    await queuePlayer(USER_B, CLIENT_B)

    redisHandler({
      type: 'matchFound',
      data: {
        mode: MatchmakingType.Match1v1,
        teamA: [{ id: USER_A, ticket: 'ticket-a' }],
        teamB: [{ id: USER_B, ticket: 'ticket-b' }],
        quality: 1,
        skillVariance: 0,
        winProbability: 0.5,
        teamARating: 1500,
        teamBRating: 1500,
        maxLatency: 0,
      },
    })
    await vi.advanceTimersByTimeAsync(0)

    const metrics = await register.getMetricsAsJSON()
    const matchesFound = metrics.find(
      m => m.name === 'shieldbattery_matchmaker_matches_found_total',
    )
    const total = (matchesFound?.values ?? []).reduce((sum, v) => sum + v.value, 0)
    // A 1v1 has two entities; the "matches found" counter must still tick exactly once per match.
    expect(total).toBe(1)
  })

  test('a match found mid-queue still lets the player accept (queue entry recorded before queuing)', async () => {
    await queuePlayer(USER_A, CLIENT_A)

    // Suspend B's Rust queue call so we can fire a matchFound event while B is still inside
    // queueSoloPlayer. The Rust search loop runs independently, so a match referencing B can arrive
    // as soon as B is in the Rust queue — before queueSoloPlayer finishes. B's queue entry must
    // already exist so handleMatchFound can set its matchId.
    let resolveBQueue: ((result: Result<void, RsMatchmakerError>) => void) | undefined
    asMockedFunction(rsQueuePlayer).mockImplementationOnce(
      () =>
        new Promise<Result<void, RsMatchmakerError>>(resolve => {
          resolveBQueue = resolve
        }),
    )

    const bQueuePromise = queuePlayer(USER_B, CLIENT_B)
    // Let queueSoloPlayer for B run up to the awaited rsQueuePlayer call.
    for (let i = 0; i < 50 && !resolveBQueue; i++) {
      await vi.advanceTimersByTimeAsync(0)
    }
    expect(resolveBQueue).toBeDefined()

    redisHandler({
      type: 'matchFound',
      data: {
        mode: MatchmakingType.Match1v1,
        teamA: [{ id: USER_A, ticket: 'ticket-a' }],
        teamB: [{ id: USER_B, ticket: 'ticket-b' }],
        quality: 1,
        skillVariance: 0,
        winProbability: 0.5,
        teamARating: 1500,
        teamBRating: 1500,
        maxLatency: 0,
      },
    })
    await vi.advanceTimersByTimeAsync(0)

    // B's queue call now returns and queueSoloPlayer completes.
    resolveBQueue!(Result.ok())
    await bQueuePromise
    await vi.advanceTimersByTimeAsync(0)

    // B is in the match, so accept() works rather than throwing NoActiveMatch (which would otherwise
    // lead to an accept-timeout ban for a player who did nothing wrong).
    await expect(service.accept(USER_B)).resolves.toBeUndefined()
    await expect(service.accept(USER_A)).resolves.toBeUndefined()
  })

  test('queues a multiqueue player with per-mode ratings and a request per mode', async () => {
    await queueMultiPlayer(USER_A, CLIENT_A, [
      MatchmakingType.Match1v1,
      MatchmakingType.Match1v1Fastest,
    ])

    // A single Rust queue call carries one rating entry per queued mode (Rust derives the queued
    // mode set from these entries).
    expect(rsQueuePlayer).toHaveBeenCalledTimes(1)
    const request = asMockedFunction(rsQueuePlayer).mock.calls[0][0]
    expect(request.id).toBe(USER_A)
    expect(request.modeRatings.map(r => r.mode).sort()).toEqual(
      [MatchmakingType.Match1v1, MatchmakingType.Match1v1Fastest].sort(),
    )

    // Each queued mode records its own request.
    const metrics = await register.getMetricsAsJSON()
    const requested = metrics.find(
      m => m.name === 'shieldbattery_matchmaker_matches_requested_total',
    )
    const byMode = new Map((requested?.values ?? []).map(v => [v.labels.matchmaking_type, v.value]))
    expect(byMode.get(MatchmakingType.Match1v1)).toBe(1)
    expect(byMode.get(MatchmakingType.Match1v1Fastest)).toBe(1)
  })

  test("forwards the client's validated region and rtt to the matchmaker", async () => {
    // The matchmaker estimates a candidate match's latency from each player's chosen region and
    // measured rtt. A region present in the live region list is passed straight through.
    await queuePlayer(USER_A, CLIENT_A, { region: REGION_US_EAST, rttMs: 24 })

    expect(gameServerRegionsService.getRegions).toHaveBeenCalled()
    const request = asMockedFunction(rsQueuePlayer).mock.calls[0][0]
    expect(request.region).toBe(REGION_US_EAST)
    expect(request.rttMs).toBe(24)
  })

  test('drops an unknown region and queues with no latency signal', async () => {
    // The region list can change between the client fetching it and queueing, so a region the server
    // no longer knows must degrade to no-region rather than rejecting the queue.
    const unknownRegion = makeGameServerRegionId('atlantis')

    await expect(
      queuePlayer(USER_A, CLIENT_A, { region: unknownRegion, rttMs: 24 }),
    ).resolves.toBeUndefined()

    const request = asMockedFunction(rsQueuePlayer).mock.calls[0][0]
    expect(request.region).toBeUndefined()
    expect(request.rttMs).toBeUndefined()
    // The player is validly queued despite the unknown region.
    await expect(service.cancel(USER_A)).resolves.toBeUndefined()
  })

  test('queues without a region when the client reports none', async () => {
    // A user with no coordinator-configured regions (dev loopback) reports no region and must still
    // be able to queue. The region list isn't even consulted in that case.
    await expect(queuePlayer(USER_A, CLIENT_A)).resolves.toBeUndefined()

    expect(gameServerRegionsService.getRegions).not.toHaveBeenCalled()
    const request = asMockedFunction(rsQueuePlayer).mock.calls[0][0]
    expect(request.region).toBeUndefined()
    expect(request.rttMs).toBeUndefined()
  })

  test('matching in one mode abandons the others without recording their completions', async () => {
    await queueMultiPlayer(USER_A, CLIENT_A, [
      MatchmakingType.Match1v1,
      MatchmakingType.Match1v1Fastest,
    ])
    await queueMultiPlayer(USER_B, CLIENT_B, [
      MatchmakingType.Match1v1,
      MatchmakingType.Match1v1Fastest,
    ])

    // The Rust matchmaker forms a 1v1 match; the players' other queued mode (Fastest) is abandoned.
    redisHandler({
      type: 'matchFound',
      data: {
        mode: MatchmakingType.Match1v1,
        teamA: [{ id: USER_A, ticket: 'ticket-a' }],
        teamB: [{ id: USER_B, ticket: 'ticket-b' }],
        quality: 1,
        skillVariance: 0,
        winProbability: 0.5,
        teamARating: 1500,
        teamBRating: 1500,
        maxLatency: 0,
      },
    })
    await vi.advanceTimersByTimeAsync(0)

    // Only the matched mode records a "found" completion for each player — the abandoned Fastest
    // search gets no terminal completion (it was superseded, not canceled).
    for (const userId of [USER_A, USER_B]) {
      const found = completionsFor(userId, MatchmakingCompletionType.Found)
      expect(found.map(c => c.matchmakingType)).toEqual([MatchmakingType.Match1v1])
    }

    // The match-found counter ticks only for the matched mode.
    const metrics = await register.getMetricsAsJSON()
    const found = metrics.find(m => m.name === 'shieldbattery_matchmaker_matches_found_total')
    expect(
      (found?.values ?? []).find(
        v => v.labels.matchmaking_type === MatchmakingType.Match1v1Fastest,
      ),
    ).toBeUndefined()

    // Both players are in the match and can accept.
    await expect(service.accept(USER_A)).resolves.toBeUndefined()
    await expect(service.accept(USER_B)).resolves.toBeUndefined()
  })

  test('canceling a multiqueue search logs a completion for each queued mode', async () => {
    await queueMultiPlayer(USER_A, CLIENT_A, [
      MatchmakingType.Match1v1,
      MatchmakingType.Match1v1Fastest,
    ])

    await service.cancel(USER_A)

    // Canceling out of a multiqueue search records a cancel completion per queued mode.
    const canceled = completionsFor(USER_A, MatchmakingCompletionType.Cancel)
    expect(canceled.map(c => c.matchmakingType).sort()).toEqual(
      [MatchmakingType.Match1v1, MatchmakingType.Match1v1Fastest].sort(),
    )

    // Each queued mode also records a canceled-request metric.
    const metrics = await register.getMetricsAsJSON()
    const cancelMetric = metrics.find(
      m => m.name === 'shieldbattery_matchmaker_match_requests_canceled_total',
    )
    const byMode = new Map(
      (cancelMetric?.values ?? []).map(v => [v.labels.matchmaking_type, v.value]),
    )
    expect(byMode.get(MatchmakingType.Match1v1)).toBe(1)
    expect(byMode.get(MatchmakingType.Match1v1Fastest)).toBe(1)
  })
})
