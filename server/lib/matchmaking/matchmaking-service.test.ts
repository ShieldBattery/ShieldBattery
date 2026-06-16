import { register } from 'prom-client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { makeSbMapId, SbMapId } from '../../../common/maps'
import { MatchmakingPreferences, MatchmakingType } from '../../../common/matchmaking'
import { asMockedFunction } from '../../../common/testing/mocks'
import { MatchFoundMessage } from '../../../common/typeshare'
import { makeSbUserId, SbUserId } from '../../../common/users/sb-user-id'
import { GameplayActivityRegistry } from '../games/gameplay-activity-registry'
import { FakeClock } from '../time/testing/fake-clock'
import { ClientSocketsGroup } from '../websockets/socket-groups'
import { TypedPublisher } from '../websockets/typed-publisher'
import {
  RS_ERROR_CODES,
  rsCancelPlayer,
  rsGetProcessToken,
  RsMatchmakerError,
  rsQueuePlayer,
  rsRequeuePlayer,
} from './matchmaker-rs-client'
import { MatchmakingService } from './matchmaking-service'
import { getMatchmakingUserPath } from './matchmaking-socket-paths'

// We only mock the network functions of the Rust client; the error type and codes stay real so
// `instanceof` / code checks behave like production.
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
import { getMatchmakingRating } from './models'

const MAP_ID: SbMapId = makeSbMapId('1')
const SEASON = { id: 1, startDate: new Date(0), name: 'test', resetMmr: false } as any

const USER_A = makeSbUserId(1)
const USER_B = makeSbUserId(2)
const CLIENT_A = 'CLIENT_A'
const CLIENT_B = 'CLIENT_B'

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

  async function queuePlayer(userId: SbUserId, clientId: string) {
    const prefs = makePreferences()
    prefs.matchmakingType = MatchmakingType.Match1v1
    ;(prefs as any).userId = userId
    await service.find(userId, clientId, [], prefs)
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

    asMockedFunction(getMatchmakingRating).mockImplementation(async (userId: SbUserId) =>
      makeMmr(userId),
    )
    asMockedFunction(rsQueuePlayer).mockResolvedValue(undefined)
    asMockedFunction(rsCancelPlayer).mockResolvedValue(undefined)
    asMockedFunction(rsRequeuePlayer).mockResolvedValue(undefined)
    asMockedFunction(rsGetProcessToken).mockResolvedValue('token-1')

    service = new MatchmakingService(
      publisher as unknown as TypedPublisher<any>,
      userSocketsManager as any,
      clientSocketsManager as any,
      matchmakingStatus as any,
      activityRegistry,
      {} as any,
      matchmakingSeasonsService as any,
      clock,
      userIdentifierManager as any,
      matchmakingBanService as any,
      restrictionService as any,
      redisSubscriber as any,
    )
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  test('recovers from an orphaned Rust queue entry by canceling and retrying once', async () => {
    asMockedFunction(rsQueuePlayer)
      .mockRejectedValueOnce(
        new RsMatchmakerError(409, RS_ERROR_CODES.alreadyInQueue, 'Player is already in the queue'),
      )
      .mockResolvedValueOnce(undefined)

    await queuePlayer(USER_A, CLIENT_A)

    expect(rsCancelPlayer).toHaveBeenCalledWith(USER_A)
    expect(rsQueuePlayer).toHaveBeenCalledTimes(2)
    // Player ended up queued, so canceling them again succeeds rather than throwing NotInQueue.
    await expect(service.cancel(USER_A)).resolves.toBeUndefined()
  })

  test('an idle-period restart does not falsely kick the next queuer', async () => {
    // Player A queues, establishing the baseline token, then cancels — emptying the queue and
    // stopping the watchdog.
    await queuePlayer(USER_A, CLIENT_A)
    await service.cancel(USER_A)

    // Watchdog tick observes the empty queue and stops, clearing the stale token baseline.
    await vi.advanceTimersByTimeAsync(5000)

    // server-rs restarts while the queue is idle (new process token).
    asMockedFunction(rsGetProcessToken).mockResolvedValue('token-2')

    // Player B queues against the new process and the watchdog re-baselines to token-2.
    await queuePlayer(USER_B, CLIENT_B)
    await vi.advanceTimersByTimeAsync(5000)

    expect(errorPublishedFor(USER_B)).toBe(false)
    // B is validly queued, so cancel works (would throw if they'd been ghosted/kicked).
    await expect(service.cancel(USER_B)).resolves.toBeUndefined()
  })

  test('tolerates a single transient token-fetch failure, ejecting only after two in a row', async () => {
    await queuePlayer(USER_A, CLIENT_A)

    asMockedFunction(rsGetProcessToken).mockRejectedValue(new Error('boom'))

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

    asMockedFunction(rsGetProcessToken).mockRejectedValueOnce(new Error('boom'))
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
      },
    })
    await vi.advanceTimersByTimeAsync(0)

    // Both players are now in a match (accept phase). server-rs restarts.
    asMockedFunction(rsGetProcessToken).mockResolvedValue('token-2')
    asMockedFunction(rsCancelPlayer).mockClear()
    await vi.advanceTimersByTimeAsync(5000)

    // Matched players must not be ejected, error-notified, or banned by restart handling.
    expect(errorPublishedFor(USER_A)).toBe(false)
    expect(errorPublishedFor(USER_B)).toBe(false)
    expect(banUser).not.toHaveBeenCalled()
    expect(rsCancelPlayer).not.toHaveBeenCalled()
  })
})
