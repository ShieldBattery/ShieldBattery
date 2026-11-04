import { register } from '@prometheus-io/client'
import { Result } from 'typescript-result'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { GameServerRegionId, makeGameServerRegionId } from '../../../common/game-server-regions'
import { makeSbMapId, SbMapId } from '../../../common/maps'
import {
  defaultPreferences,
  MatchmakingCompletionType,
  MatchmakingDivision,
  MatchmakingPreferences,
  MatchmakingServiceErrorCode,
  MatchmakingType,
} from '../../../common/matchmaking'
import { RaceChar } from '../../../common/races'
import { asMockedFunction } from '../../../common/testing/mocks'
import { MatchFoundMessage } from '../../../common/typeshare'
import { FriendActivityStatus } from '../../../common/users/relationships'
import { makeSbUserId, SbUserId } from '../../../common/users/sb-user-id'
import { BaseGameLoaderError, GameLoadErrorType } from '../games/game-loader'
import { GameplayActivityRegistry } from '../games/gameplay-activity-registry'
import { FakeClock } from '../time/testing/fake-clock'
import { MachineSupportRegistry } from '../users/machine-support-registry'
import { createFakeActivityStatusService } from '../users/testing/activity-status-service'
import { ClientSocketsGroup } from '../websockets/socket-groups'
import { TypedPublisher } from '../websockets/typed-publisher'
import {
  MatchmakerClient,
  RsClientErrorCode,
  RsMatchmakerError,
  RsMatchmakerErrorCode,
} from './matchmaker-rs-client'
import { MatchmakingService } from './matchmaking-service'
import {
  getMatchmakingClientPath,
  getMatchmakingUserPath,
  getMatchPath,
} from './matchmaking-socket-paths'

vi.mock('./models', () => ({
  getMatchmakingRatings: vi.fn(),
  getManyMatchmakingRatings: vi.fn(),
  createInitialMatchmakingRating: vi.fn(),
  insertMatchmakingCompletion: vi.fn().mockResolvedValue(undefined),
  insertMatchmakingDraftMessages: vi.fn().mockResolvedValue(undefined),
  insertMatchmakingMatchFormation: vi.fn().mockResolvedValue(undefined),
}))

// The queue path loads a player's ratings on a shared connection; there's no connection pool in unit
// tests, so run the callback with a stand-in client (every model call it makes is mocked).
vi.mock('../db', async () => ({
  ...(await vi.importActual<any>('../db')),
  withDbClient: vi.fn(async (fn: (client: any) => Promise<any>) => await fn({})),
}))

vi.mock('./matchmaking-map-pools-models', async () => ({
  ...(await vi.importActual<any>('./matchmaking-map-pools-models')),
  getCurrentMapPool: vi.fn(),
}))

vi.mock('../maps/map-models', async () => ({
  ...(await vi.importActual<any>('../maps/map-models')),
  getMapInfos: vi.fn(),
}))

vi.mock('../games/game-models', async () => ({
  ...(await vi.importActual<any>('../games/game-models')),
  getRecentMatchmakingOpponents: vi.fn().mockResolvedValue([]),
}))

import { getRecentMatchmakingOpponents } from '../games/game-models'
import { getMapInfos } from '../maps/map-models'
import { getCurrentMapPool } from './matchmaking-map-pools-models'
import {
  getManyMatchmakingRatings,
  getMatchmakingRatings,
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
/** A stand-in per-session public key (base64); the service stores it verbatim without validating. */
const DEFAULT_PUBKEY = Buffer.alloc(32, 7).toString('base64')

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

function makeMmr(userId: SbUserId, matchmakingType = MatchmakingType.Match1v1) {
  return {
    userId,
    matchmakingType,
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

function createFakeMatchmakerClient() {
  return {
    getProcessToken: vi.fn<MatchmakerClient['getProcessToken']>(),
    queue: vi.fn<MatchmakerClient['queue']>(),
    cancel: vi.fn<MatchmakerClient['cancel']>(),
    requeue: vi.fn<MatchmakerClient['requeue']>(),
  }
}

describe('matchmaking/matchmaking-service', () => {
  let matchmakerClient: ReturnType<typeof createFakeMatchmakerClient>
  let service: MatchmakingService
  let publisher: { publish: ReturnType<typeof vi.fn> }
  let activityRegistry: GameplayActivityRegistry
  let banUser: ReturnType<typeof vi.fn>
  let checkUser: ReturnType<typeof vi.fn>
  let checkUsers: ReturnType<typeof vi.fn>
  let clientSockets: Map<SbUserId, ClientSocketsGroup>
  let gameLoader: {
    loadGame: ReturnType<typeof vi.fn<(request: any) => Promise<any>>>
    cancelLoadingWithoutBlame: ReturnType<typeof vi.fn>
  }
  let gameServerRegionsService: {
    getRegions: ReturnType<typeof vi.fn>
  }
  let netcodeV2Service: {
    warmRegions: ReturnType<typeof vi.fn>
  }
  let redisHandler: (event: { type: 'matchFound'; data: MatchFoundMessage }) => void
  let machineSupport: MachineSupportRegistry

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

  /** The search id of every queue request sent to the matchmaker for a player, oldest first. */
  function queuedSearchIds(userId: SbUserId): string[] {
    return matchmakerClient.queue.mock.calls
      .filter(([r]) => r.id === userId)
      .map(([r]) => r.searchId)
  }

  /**
   * A player as the matchmaker names them in a match it formed from their most recently queued
   * search.
   */
  function matched(userId: SbUserId, ticket: string) {
    return { id: userId, ticket, searchId: queuedSearchIds(userId).at(-1) ?? 'never-queued' }
  }

  /** The id of the match a player's client was most recently told it was found for. */
  function foundMatchId(userId: SbUserId): string {
    const client = clientSockets.get(userId)!
    const found = asMockedFunction(client.subscribe)
      .mock.calls.filter(([path]) => path.startsWith(getMatchPath('')))
      .map(([, getInitialData]) => (getInitialData as (c: ClientSocketsGroup) => any)(client))
      .filter(data => data?.type === 'matchFound')
    return found.at(-1)?.matchId ?? 'never-found'
  }

  /** Accepts the match the player's client was most recently told about. */
  function acceptFoundMatch(userId: SbUserId): Promise<void> {
    return service.accept(userId, foundMatchId(userId))
  }

  async function queuePlayer(
    userId: SbUserId,
    clientId: string,
    desiredRegion?: { region?: GameServerRegionId; rttMs?: number; regionManual?: boolean },
    clientPubkey: string = DEFAULT_PUBKEY,
  ) {
    const prefs = makePreferences()
    prefs.matchmakingType = MatchmakingType.Match1v1
    ;(prefs as any).userId = userId
    await service.find(userId, clientId, [], [prefs], clientPubkey, desiredRegion)
  }

  /** Like `queuePlayer`, but with an explicit main race and alternate-race preference data. */
  async function queuePlayerWithRacePrefs(
    userId: SbUserId,
    clientId: string,
    race: RaceChar,
    data: MatchmakingPreferences['data'],
  ) {
    const prefs = makePreferences()
    prefs.matchmakingType = MatchmakingType.Match1v1
    ;(prefs as any).userId = userId
    prefs.race = race
    prefs.data = data
    await service.find(userId, clientId, [], [prefs], DEFAULT_PUBKEY)
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
    await service.find(userId, clientId, [], allPrefs, DEFAULT_PUBKEY)
  }

  function completionsFor(userId: SbUserId, completionType: MatchmakingCompletionType) {
    return asMockedFunction(insertMatchmakingCompletion)
      .mock.calls.map(call => call[0])
      .filter(c => c.userId === userId && c.completionType === completionType)
  }

  async function drainMatchmakingTasks(): Promise<void> {
    for (let i = 0; i < 5; i++) {
      await vi.advanceTimersByTimeAsync(0)
    }
  }

  beforeEach(() => {
    vi.clearAllMocks()
    register.clear()
    vi.useFakeTimers()

    const clock = new FakeClock()
    clock.setCurrentTime(1_000_000)

    publisher = { publish: vi.fn() }
    activityRegistry = new GameplayActivityRegistry(createFakeActivityStatusService())
    banUser = vi.fn().mockResolvedValue(undefined)
    clientSockets = new Map([
      [USER_A, createFakeClient(USER_A, CLIENT_A)],
      [USER_B, createFakeClient(USER_B, CLIENT_B)],
    ])
    // Defaults to a never-resolving load so tests that only exercise earlier phases (accept, etc.)
    // behave as before; tests that need a completed load override this with a resolved result.
    gameLoader = {
      loadGame: vi.fn().mockReturnValue(new Promise<never>(() => {})),
      cancelLoadingWithoutBlame: vi.fn().mockReturnValue(true),
    }

    const userSocketsManager = { on: vi.fn(), getById: vi.fn() }
    const clientSocketsManager = {
      getById: vi.fn((userId: SbUserId, _clientId: string) => clientSockets.get(userId)),
    }
    const matchmakingStatus = { isEnabled: () => true }
    const matchmakingSeasonsService = { getCurrentSeason: vi.fn().mockResolvedValue(SEASON) }
    const userIdentifierManager = { findUsersWithIdentifiers: vi.fn().mockResolvedValue([]) }
    checkUser = vi.fn().mockResolvedValue(undefined)
    checkUsers = vi.fn().mockResolvedValue(new Set())
    const matchmakingBanService = { banUser, checkUser, checkUsers }
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
    netcodeV2Service = {
      warmRegions: vi.fn(),
    }

    asMockedFunction(getMatchmakingRatings).mockImplementation(
      async (userId: SbUserId, types: ReadonlyArray<MatchmakingType>) =>
        types.map(type => makeMmr(userId, type)),
    )
    asMockedFunction(getManyMatchmakingRatings).mockImplementation(
      async (userIds: SbUserId[], type: MatchmakingType) => userIds.map(id => makeMmr(id, type)),
    )
    matchmakerClient = createFakeMatchmakerClient()
    matchmakerClient.queue.mockResolvedValue(Result.ok())
    matchmakerClient.cancel.mockResolvedValue(Result.ok())
    matchmakerClient.requeue.mockResolvedValue(Result.ok())
    matchmakerClient.getProcessToken.mockResolvedValue(Result.ok('token-1'))
    machineSupport = new MachineSupportRegistry()

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
      netcodeV2Service as any,
      matchmakerClient as unknown as MatchmakerClient,
      machineSupport,
    )
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  test('does not warm regions when players join or remain in the queue', async () => {
    await queuePlayer(USER_A, CLIENT_A, { region: REGION_US_EAST, rttMs: 20 })
    await queuePlayer(USER_B, CLIENT_B)

    expect(netcodeV2Service.warmRegions).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(180_000)
    expect(netcodeV2Service.warmRegions).not.toHaveBeenCalled()

    await service.cancel(USER_A)
    await service.cancel(USER_B)
    await vi.advanceTimersByTimeAsync(120_000)
    expect(netcodeV2Service.warmRegions).not.toHaveBeenCalled()
  })

  test.each([
    { name: 'shared region', regions: ['us-east', 'us-east'], expected: ['us-east'] },
    {
      name: 'different regions',
      regions: ['us-east', 'eu-west'],
      expected: ['us-east', 'eu-west'],
    },
    { name: 'one missing region', regions: [undefined, 'eu-west'], expected: ['eu-west'] },
    { name: 'no regions', regions: [undefined, undefined], expected: [] },
    {
      name: 'team match',
      regions: ['us-east', undefined, 'eu-west', 'us-east'],
      expected: ['us-east', 'eu-west'],
    },
  ])('warms only matched regions before acceptance: $name', async ({ regions, expected }) => {
    const mode = regions.length === 4 ? MatchmakingType.Match2v2 : MatchmakingType.Match1v1
    gameServerRegionsService.getRegions.mockResolvedValue(
      ['us-east', 'eu-west', 'unmatched'].map(id => ({ id: makeGameServerRegionId(id) })),
    )
    asMockedFunction(getCurrentMapPool).mockResolvedValue({ maps: [MAP_ID] } as any)
    asMockedFunction(getMapInfos).mockResolvedValue([{ id: MAP_ID } as any])

    const entries = []
    for (const [index, region] of regions.entries()) {
      const userId = makeSbUserId(index + 1)
      const clientId = 'CLIENT_' + userId
      clientSockets.set(userId, createFakeClient(userId, clientId))
      await service.find(
        userId,
        clientId,
        [],
        [{ ...defaultPreferences(mode, userId), mapSelections: [MAP_ID] }],
        DEFAULT_PUBKEY,
        region ? { region: makeGameServerRegionId(region), regionManual: true } : undefined,
      )
      entries.push(matched(userId, 'ticket-' + userId))
    }
    const unmatchedUser = makeSbUserId(10)
    clientSockets.set(unmatchedUser, createFakeClient(unmatchedUser, 'UNMATCHED'))
    await queuePlayer(unmatchedUser, 'UNMATCHED', { region: makeGameServerRegionId('unmatched') })
    expect(netcodeV2Service.warmRegions).not.toHaveBeenCalled()

    redisHandler({
      type: 'matchFound',
      data: {
        mode,
        teamA: entries.slice(0, entries.length / 2),
        teamB: entries.slice(entries.length / 2),
        quality: 1,
        skillVariance: 0,
        ratingVarianceMultiplier: 1,
        winProbability: 0.5,
        teamARating: 1500,
        teamBRating: 1500,
        maxLatency: 0,
        rematchPenalty: 0,
      },
    })
    await drainMatchmakingTasks()

    expect(netcodeV2Service.warmRegions.mock.calls).toEqual(expected.length ? [[expected]] : [])
    expect(gameLoader.loadGame).not.toHaveBeenCalled()

    // Acceptance times out, but the unmatched player keeps searching without renewing any region.
    await vi.advanceTimersByTimeAsync(120_000)
    expect(netcodeV2Service.warmRegions).toHaveBeenCalledTimes(expected.length ? 1 : 0)
  })

  test('refuses a search from a client that reported an unsupported machine', async () => {
    machineSupport.record(USER_A, CLIENT_A, 'socket-1', false)

    await expect(queuePlayer(USER_A, CLIENT_A)).rejects.toMatchObject({
      code: MatchmakingServiceErrorCode.UnsupportedMachine,
    })
    expect(matchmakerClient.queue).not.toHaveBeenCalled()
    await expect(service.cancel(USER_A)).rejects.toMatchObject({
      code: MatchmakingServiceErrorCode.NotInQueue,
    })
  })

  test('allows searches from supported clients', async () => {
    machineSupport.record(USER_A, CLIENT_A, 'socket-1', false)
    machineSupport.record(USER_B, CLIENT_B, 'socket-2', true)

    await queuePlayer(USER_B, CLIENT_B)
    expect(matchmakerClient.queue).toHaveBeenCalledWith(expect.objectContaining({ id: USER_B }))

    machineSupport.forget(USER_A, CLIENT_A, 'socket-1')
    await queuePlayer(USER_A, CLIENT_A)
    expect(matchmakerClient.queue).toHaveBeenCalledWith(expect.objectContaining({ id: USER_A }))
  })

  test('recovers from an orphaned Rust queue entry by canceling and retrying once', async () => {
    matchmakerClient.queue
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

    expect(matchmakerClient.cancel).toHaveBeenCalledWith(USER_A)
    expect(matchmakerClient.queue).toHaveBeenCalledTimes(2)
    // Player ended up queued, so canceling them again succeeds rather than throwing NotInQueue.
    await expect(service.cancel(USER_A)).resolves.toBeUndefined()
  })

  test("waits for a canceled search's removal before queuing the next search", async () => {
    await queuePlayer(USER_A, CLIENT_A)
    let finishCancel!: () => void
    matchmakerClient.cancel.mockImplementationOnce(
      () => new Promise(resolve => (finishCancel = () => resolve(Result.ok()))),
    )
    await service.cancel(USER_A)

    const searching = queuePlayer(USER_A, CLIENT_A)
    await drainMatchmakingTasks()
    // The matchmaker handles requests in any order, so a removal still in flight could otherwise
    // land after the new search's queue request and drop the new search
    expect(matchmakerClient.queue).toHaveBeenCalledTimes(1)

    finishCancel()
    await searching
    expect(matchmakerClient.queue).toHaveBeenCalledTimes(2)
    await expect(service.cancel(USER_A)).resolves.toBeUndefined()
  })

  test("doesn't give a search a match formed from the player's previous search", async () => {
    await queuePlayer(USER_A, CLIENT_A)
    await queuePlayer(USER_B, CLIENT_B)
    let finishCancel!: () => void
    matchmakerClient.cancel.mockImplementationOnce(
      () => new Promise(resolve => (finishCancel = () => resolve(Result.ok()))),
    )
    await service.cancel(USER_A)
    const searching = queuePlayer(USER_A, CLIENT_A)
    await drainMatchmakingTasks()

    // The matchmaker matched A's previous search before that search's removal reached it. A's new
    // search hasn't even been sent to the matchmaker yet, so the match can't be for it.
    redisHandler({
      type: 'matchFound',
      data: {
        mode: MatchmakingType.Match1v1,
        teamA: [matched(USER_A, 'ticket-a')],
        teamB: [matched(USER_B, 'ticket-b')],
        quality: 1,
        skillVariance: 0,
        ratingVarianceMultiplier: 1,
        winProbability: 0.5,
        teamARating: 1500,
        teamBRating: 1500,
        maxLatency: 0,
        rematchPenalty: 0,
      },
    })
    await drainMatchmakingTasks()

    expect(matchmakerClient.requeue).toHaveBeenCalledWith('ticket-b')
    expect(matchmakerClient.requeue).not.toHaveBeenCalledWith('ticket-a')
    await expect(acceptFoundMatch(USER_A)).rejects.toThrow('No active match')

    finishCancel()
    await searching
    expect(matchmakerClient.queue).toHaveBeenLastCalledWith(expect.objectContaining({ id: USER_A }))
    await expect(service.cancel(USER_A)).resolves.toBeUndefined()
  })

  test("doesn't give a queued search a match formed from the player's previous search", async () => {
    await queuePlayer(USER_A, CLIENT_A)
    await queuePlayer(USER_B, CLIENT_B)
    const previousSearch = matched(USER_A, 'ticket-a')
    await service.cancel(USER_A)
    await drainMatchmakingTasks()
    await queuePlayer(USER_A, CLIENT_A)

    // The matchmaker matched A's previous search before that search's removal reached it, and the
    // match's event only arrives once A's new search is queued
    redisHandler({
      type: 'matchFound',
      data: {
        mode: MatchmakingType.Match1v1,
        teamA: [previousSearch],
        teamB: [matched(USER_B, 'ticket-b')],
        quality: 1,
        skillVariance: 0,
        ratingVarianceMultiplier: 1,
        winProbability: 0.5,
        teamARating: 1500,
        teamBRating: 1500,
        maxLatency: 0,
        rematchPenalty: 0,
      },
    })
    await drainMatchmakingTasks()

    expect(matchmakerClient.requeue).toHaveBeenCalledWith('ticket-b')
    expect(matchmakerClient.requeue).not.toHaveBeenCalledWith('ticket-a')
    await expect(acceptFoundMatch(USER_A)).rejects.toThrow('No active match')
    await expect(service.cancel(USER_A)).resolves.toBeUndefined()
  })

  describe('a search that changes while it is being queued', () => {
    let finishQueue: (result: Result<void, RsMatchmakerError>) => void

    /** Holds the next queue request's response until the test calls `finishQueue`. */
    function holdNextQueueRequest() {
      matchmakerClient.queue.mockImplementationOnce(
        () => new Promise(resolve => (finishQueue = resolve)),
      )
    }

    test("isn't shown to the player once they've canceled it", async () => {
      holdNextQueueRequest()
      const searching = queuePlayer(USER_A, CLIENT_A)
      await drainMatchmakingTasks()
      await service.cancel(USER_A)

      finishQueue(Result.ok())
      await searching

      const clientA = clientSockets.get(USER_A)!
      const searchSubscriptions = asMockedFunction(clientA.subscribe).mock.calls.filter(
        ([path]) => path === getMatchmakingClientPath(clientA),
      )
      expect(searchSubscriptions).toEqual([])
    })

    test("doesn't tear down the player's next search when its queue request fails", async () => {
      holdNextQueueRequest()
      const searching = queuePlayer(USER_A, CLIENT_A)
      await drainMatchmakingTasks()
      await service.cancel(USER_A)
      const nextSearch = queuePlayer(USER_A, CLIENT_A)
      await drainMatchmakingTasks()

      finishQueue(Result.error(new RsMatchmakerError(RsClientErrorCode.ServiceUnavailable, 'boom')))
      await searching.catch(() => {})
      await nextSearch

      expect(errorPublishedFor(USER_A)).toBe(false)
      await expect(service.cancel(USER_A)).resolves.toBeUndefined()
    })

    test("keeps the player in a match found before its queue request's response was lost", async () => {
      await queuePlayer(USER_B, CLIENT_B)
      holdNextQueueRequest()
      const searching = queuePlayer(USER_A, CLIENT_A)
      await drainMatchmakingTasks()
      redisHandler({
        type: 'matchFound',
        data: {
          mode: MatchmakingType.Match1v1,
          teamA: [matched(USER_A, 'ticket-a')],
          teamB: [matched(USER_B, 'ticket-b')],
          quality: 1,
          skillVariance: 0,
          ratingVarianceMultiplier: 1,
          winProbability: 0.5,
          teamARating: 1500,
          teamBRating: 1500,
          maxLatency: 0,
          rematchPenalty: 0,
        },
      })
      await drainMatchmakingTasks()

      // The matchmaker handled the request (it matched the player), but the response never arrived
      finishQueue(Result.error(new RsMatchmakerError(RsClientErrorCode.ServiceUnavailable, 'boom')))
      await searching.catch(() => {})

      await expect(acceptFoundMatch(USER_A)).resolves.toBeUndefined()
      await expect(service.cancel(USER_A)).rejects.toThrow('cannot be canceled')
    })

    test('keeps searching once that match falls apart and the player is requeued', async () => {
      await queuePlayer(USER_B, CLIENT_B)
      holdNextQueueRequest()
      const searching = queuePlayer(USER_A, CLIENT_A)
      await drainMatchmakingTasks()
      redisHandler({
        type: 'matchFound',
        data: {
          mode: MatchmakingType.Match1v1,
          teamA: [matched(USER_A, 'ticket-a')],
          teamB: [matched(USER_B, 'ticket-b')],
          quality: 1,
          skillVariance: 0,
          ratingVarianceMultiplier: 1,
          winProbability: 0.5,
          teamARating: 1500,
          teamBRating: 1500,
          maxLatency: 0,
          rematchPenalty: 0,
        },
      })
      await drainMatchmakingTasks()
      const clientB = clientSockets.get(USER_B)!
      const onCloseB = asMockedFunction(clientB.subscribe)
        .mock.calls.map(call => call[2])
        .find(callback => typeof callback === 'function')!
      onCloseB(clientB)
      await drainMatchmakingTasks()

      finishQueue(Result.error(new RsMatchmakerError(RsClientErrorCode.ServiceUnavailable, 'boom')))
      await searching.catch(() => {})
      await drainMatchmakingTasks()

      expect(matchmakerClient.requeue).toHaveBeenCalledWith('ticket-a')
      expect(errorPublishedFor(USER_A)).toBe(false)
      await expect(service.cancel(USER_A)).resolves.toBeUndefined()
    })
  })

  test("doesn't queue the player in Rust when the token fetch fails", async () => {
    // The queue starts idle, so the first queuer triggers a token fetch, which comes before queuing
    matchmakerClient.getProcessToken.mockResolvedValueOnce(
      Result.error(new RsMatchmakerError(RsClientErrorCode.ServiceUnavailable, 'boom')),
    )

    await expect(queuePlayer(USER_A, CLIENT_A)).rejects.toThrow('boom')

    expect(matchmakerClient.queue).not.toHaveBeenCalled()
    await expect(service.cancel(USER_A)).rejects.toThrow('does not have an active')
  })

  test('notices a restart right after the first player is queued', async () => {
    matchmakerClient.queue.mockImplementationOnce(async () => {
      // server-rs handles the queue request and then restarts, losing the player
      matchmakerClient.getProcessToken.mockResolvedValue(Result.ok('token-2'))
      return Result.ok()
    })

    await queuePlayer(USER_A, CLIENT_A)
    await vi.advanceTimersByTimeAsync(5000)

    expect(errorPublishedFor(USER_A)).toBe(true)
  })

  test("doesn't queue a search that was canceled while the token was being fetched", async () => {
    let finishTokenFetch!: (result: Result<string, RsMatchmakerError>) => void
    matchmakerClient.getProcessToken.mockImplementationOnce(
      () => new Promise(resolve => (finishTokenFetch = resolve)),
    )
    const searching = queuePlayer(USER_A, CLIENT_A)
    await drainMatchmakingTasks()
    await service.cancel(USER_A)

    finishTokenFetch(Result.ok('token-1'))
    await searching.catch(() => {})

    // The cancel already went out, so a queue request now would be left behind in the matchmaker
    expect(matchmakerClient.queue).not.toHaveBeenCalled()
  })

  test('an idle-period restart does not falsely kick the next queuer', async () => {
    // Player A queues, establishing the baseline token, then cancels — emptying the queue and
    // stopping the watchdog.
    await queuePlayer(USER_A, CLIENT_A)
    await service.cancel(USER_A)

    // Watchdog tick observes the empty queue and stops, clearing the stale token baseline.
    await vi.advanceTimersByTimeAsync(5000)

    // server-rs restarts while the queue is idle (new process token).
    matchmakerClient.getProcessToken.mockResolvedValue(Result.ok('token-2'))

    // Player B queues against the new process and the watchdog re-baselines to token-2.
    await queuePlayer(USER_B, CLIENT_B)
    await vi.advanceTimersByTimeAsync(5000)

    expect(errorPublishedFor(USER_B)).toBe(false)
    // B is validly queued, so cancel works (would throw if they'd been ghosted/kicked).
    await expect(service.cancel(USER_B)).resolves.toBeUndefined()
  })

  test('tolerates a single transient token-fetch failure, ejecting only after two in a row', async () => {
    await queuePlayer(USER_A, CLIENT_A)

    matchmakerClient.getProcessToken.mockResolvedValue(
      Result.error(new RsMatchmakerError(RsClientErrorCode.ServiceUnavailable, 'boom')),
    )

    // First failure: do not eject.
    await vi.advanceTimersByTimeAsync(5000)
    expect(errorPublishedFor(USER_A)).toBe(false)

    // Second consecutive failure: now treat it as a restart and eject.
    await vi.advanceTimersByTimeAsync(5000)
    expect(errorPublishedFor(USER_A)).toBe(true)
    // Best-effort cleanup of the (possibly still-present) Rust queue entry.
    expect(matchmakerClient.cancel).toHaveBeenCalledWith(USER_A)
  })

  test('a single failure followed by a success resets the failure counter', async () => {
    await queuePlayer(USER_A, CLIENT_A)

    matchmakerClient.getProcessToken.mockResolvedValueOnce(
      Result.error(new RsMatchmakerError(RsClientErrorCode.ServiceUnavailable, 'boom')),
    )
    await vi.advanceTimersByTimeAsync(5000) // failure 1
    await vi.advanceTimersByTimeAsync(5000) // success, resets counter

    expect(errorPublishedFor(USER_A)).toBe(false)
  })

  test('requeues innocent players when a match is dropped due to missing player data', async () => {
    await queuePlayer(USER_A, CLIENT_A, { region: REGION_US_EAST, rttMs: 20 })
    await queuePlayer(USER_B, CLIENT_B)

    // B cancels in the window before the match event is processed, dropping their queue data.
    await service.cancel(USER_B)

    redisHandler({
      type: 'matchFound',
      data: {
        mode: MatchmakingType.Match1v1,
        teamA: [matched(USER_A, 'ticket-a')],
        teamB: [matched(USER_B, 'ticket-b')],
        quality: 1,
        skillVariance: 0,
        ratingVarianceMultiplier: 1,
        winProbability: 0.5,
        teamARating: 1500,
        teamBRating: 1500,
        maxLatency: 0,
        rematchPenalty: 0,
      },
    })
    await vi.advanceTimersByTimeAsync(0)

    expect(netcodeV2Service.warmRegions).not.toHaveBeenCalled()

    // A is innocent: they get requeued with their event ticket rather than ejected with an error.
    expect(matchmakerClient.requeue).toHaveBeenCalledWith('ticket-a')
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
        teamA: [matched(USER_A, 'ticket-a')],
        teamB: [matched(USER_B, 'ticket-b')],
        quality: 1,
        skillVariance: 0,
        ratingVarianceMultiplier: 1,
        winProbability: 0.5,
        teamARating: 1500,
        teamBRating: 1500,
        maxLatency: 0,
        rematchPenalty: 0,
      },
    })
    await vi.advanceTimersByTimeAsync(0)

    // Both players are now in a match (accept phase). server-rs restarts.
    matchmakerClient.getProcessToken.mockResolvedValue(Result.ok('token-2'))
    matchmakerClient.cancel.mockClear()
    await vi.advanceTimersByTimeAsync(5000)

    // Matched players must not be ejected, error-notified, or banned by restart handling.
    expect(errorPublishedFor(USER_A)).toBe(false)
    expect(errorPublishedFor(USER_B)).toBe(false)
    expect(banUser).not.toHaveBeenCalled()
    expect(matchmakerClient.cancel).not.toHaveBeenCalled()
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
        teamA: [matched(USER_A, 'ticket-a')],
        teamB: [matched(USER_B, 'ticket-b')],
        quality: 12.5,
        skillVariance: 30000,
        ratingVarianceMultiplier: 1.5,
        winProbability: 0.42,
        teamARating: 1500,
        teamBRating: 1600,
        maxLatency: 1,
        rematchPenalty: 42.5,
      },
    })
    await vi.advanceTimersByTimeAsync(0)

    // Both players accept, so the match runs through map selection and a successful game load.
    await acceptFoundMatch(USER_A)
    await acceptFoundMatch(USER_B)
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
      ratingVarianceMultiplier: 1.5,
      winProbability: 0.42,
      teamARating: 1500,
      teamBRating: 1600,
      teamAUserIds: [USER_A],
      teamBUserIds: [USER_B],
      teamAPlayerRatings: [1500],
      teamBPlayerRatings: [1500],
      maxLatency: 1,
      rematchPenalty: 42.5,
    })
  })

  test('forwards each queued player rtt and region source to the game loader with their region', async () => {
    asMockedFunction(getCurrentMapPool).mockResolvedValue({ maps: [MAP_ID] } as any)
    asMockedFunction(getMapInfos).mockResolvedValue([{ id: MAP_ID } as any])
    gameLoader.loadGame.mockResolvedValue(Result.ok({ gameId: GAME_ID }))

    // A queued with a hand-picked region + rtt; B queues with neither, so B must reach the loader
    // region-blind, without an rtt entry, and with no region source to report.
    await queuePlayer(USER_A, CLIENT_A, { region: REGION_US_EAST, rttMs: 24, regionManual: true })
    await queuePlayer(USER_B, CLIENT_B)

    redisHandler({
      type: 'matchFound',
      data: {
        mode: MatchmakingType.Match1v1,
        teamA: [matched(USER_A, 'ticket-a')],
        teamB: [matched(USER_B, 'ticket-b')],
        quality: 12.5,
        skillVariance: 30000,
        ratingVarianceMultiplier: 1,
        winProbability: 0.42,
        teamARating: 1500,
        teamBRating: 1600,
        maxLatency: 1,
        rematchPenalty: 0,
      },
    })
    await vi.advanceTimersByTimeAsync(0)

    await acceptFoundMatch(USER_A)
    await acceptFoundMatch(USER_B)
    // Drain the runMatch promise chain (accept -> pickMap -> draft -> doGameLoad -> loadGame).
    for (let i = 0; i < 20; i++) {
      await vi.advanceTimersByTimeAsync(0)
    }

    expect(gameLoader.loadGame).toHaveBeenCalledTimes(1)
    const request = gameLoader.loadGame.mock.calls[0][0]
    const slotForA = request.players.find((p: any) => p.userId === USER_A)
    const slotForB = request.players.find((p: any) => p.userId === USER_B)
    expect(slotForA.region).toBe(REGION_US_EAST)
    expect(slotForB.region).toBeUndefined()
    expect(slotForA.rttMs).toBe(24)
    expect(slotForB.rttMs).toBeUndefined()
    expect(slotForA.regionManual).toBe(true)
    expect(slotForB.regionManual).toBeUndefined()
    // Both players submitted a pubkey when they queued; each reaches the loader on their own
    // player entry.
    expect(slotForA.netcodeV2Pubkey).toBe(DEFAULT_PUBKEY)
    expect(slotForB.netcodeV2Pubkey).toBe(DEFAULT_PUBKEY)
  })

  test('preserves a queued player pubkey across a requeue', async () => {
    asMockedFunction(getCurrentMapPool).mockResolvedValue({ maps: [MAP_ID] } as any)
    asMockedFunction(getMapInfos).mockResolvedValue([{ id: MAP_ID } as any])
    gameLoader.loadGame.mockResolvedValue(Result.ok({ gameId: GAME_ID }))

    // A distinct key for A so the final assertion proves A's own key survived, not a coincidence.
    const pubkeyA = Buffer.alloc(32, 3).toString('base64')
    await queuePlayer(USER_A, CLIENT_A, undefined, pubkeyA)
    await queuePlayer(USER_B, CLIENT_B)

    // B cancels before the match is processed, so A is requeued as innocent (its queue data — pubkey
    // included — is kept, only `queuedAt` is refreshed).
    await service.cancel(USER_B)
    redisHandler({
      type: 'matchFound',
      data: {
        mode: MatchmakingType.Match1v1,
        teamA: [matched(USER_A, 'ticket-a')],
        teamB: [matched(USER_B, 'ticket-b')],
        quality: 1,
        skillVariance: 0,
        ratingVarianceMultiplier: 1,
        winProbability: 0.5,
        teamARating: 1500,
        teamBRating: 1500,
        maxLatency: 0,
        rematchPenalty: 0,
      },
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(matchmakerClient.requeue).toHaveBeenCalledWith('ticket-a')

    // A fresh opponent queues and a new match forms; the load must carry A's original pubkey.
    await queuePlayer(USER_B, CLIENT_B)
    redisHandler({
      type: 'matchFound',
      data: {
        mode: MatchmakingType.Match1v1,
        teamA: [matched(USER_A, 'ticket-a2')],
        teamB: [matched(USER_B, 'ticket-b2')],
        quality: 1,
        skillVariance: 0,
        ratingVarianceMultiplier: 1,
        winProbability: 0.5,
        teamARating: 1500,
        teamBRating: 1500,
        maxLatency: 0,
        rematchPenalty: 0,
      },
    })
    await vi.advanceTimersByTimeAsync(0)
    await acceptFoundMatch(USER_A)
    await acceptFoundMatch(USER_B)
    for (let i = 0; i < 20; i++) {
      await vi.advanceTimersByTimeAsync(0)
    }

    expect(gameLoader.loadGame).toHaveBeenCalledTimes(1)
    const request = gameLoader.loadGame.mock.calls[0][0]
    const slotForA = request.players.find((p: any) => p.userId === USER_A)
    expect(slotForA.netcodeV2Pubkey).toBe(pubkeyA)
  })

  test('builds playerInfos for the matched game, including the alternate-race branch', async () => {
    asMockedFunction(getCurrentMapPool).mockResolvedValue({ maps: [MAP_ID] } as any)
    asMockedFunction(getMapInfos).mockResolvedValue([{ id: MAP_ID } as any])
    gameLoader.loadGame.mockResolvedValue(Result.ok({ gameId: GAME_ID }))

    // Both queue the same main race, but only B opts into playing its alternate on the mirror
    // matchup, so B (and only B) should land on its alternate race while A keeps its main one.
    await queuePlayerWithRacePrefs(USER_A, CLIENT_A, 'z', {
      useAlternateRace: false,
      alternateRace: 't',
    })
    await queuePlayerWithRacePrefs(USER_B, CLIENT_B, 'z', {
      useAlternateRace: true,
      alternateRace: 't',
    })

    redisHandler({
      type: 'matchFound',
      data: {
        mode: MatchmakingType.Match1v1,
        teamA: [matched(USER_A, 'ticket-a')],
        teamB: [matched(USER_B, 'ticket-b')],
        quality: 12.5,
        skillVariance: 30000,
        ratingVarianceMultiplier: 1,
        winProbability: 0.42,
        teamARating: 1500,
        teamBRating: 1600,
        maxLatency: 1,
        rematchPenalty: 0,
      },
    })
    await vi.advanceTimersByTimeAsync(0)

    await acceptFoundMatch(USER_A)
    await acceptFoundMatch(USER_B)
    // Drain the runMatch promise chain (accept -> pickMap -> draft -> doGameLoad -> loadGame).
    for (let i = 0; i < 20; i++) {
      await vi.advanceTimersByTimeAsync(0)
    }

    expect(gameLoader.loadGame).toHaveBeenCalledTimes(1)
    const request = gameLoader.loadGame.mock.calls[0][0]
    const infoForA = request.playerInfos.find((p: any) => p.userId === USER_A)
    const infoForB = request.playerInfos.find((p: any) => p.userId === USER_B)

    for (const info of [infoForA, infoForB]) {
      expect(info.typeId).toBe(6)
      expect(info.playerId).toBe(0)
      expect(info.type).toBe('human')
    }
    expect(infoForA.race).toBe('z')
    // B opted into its alternate race for the mirror matchup; A did not, so A keeps its main race.
    expect(infoForB.race).toBe('t')
  })

  describe('forwards each player rank to the game loader', () => {
    async function loadMatch() {
      asMockedFunction(getCurrentMapPool).mockResolvedValue({ maps: [MAP_ID] } as any)
      asMockedFunction(getMapInfos).mockResolvedValue([{ id: MAP_ID } as any])
      gameLoader.loadGame.mockResolvedValue(Result.ok({ gameId: GAME_ID }))

      await queuePlayer(USER_A, CLIENT_A)
      await queuePlayer(USER_B, CLIENT_B)

      redisHandler({
        type: 'matchFound',
        data: {
          mode: MatchmakingType.Match1v1,
          teamA: [matched(USER_A, 'ticket-a')],
          teamB: [matched(USER_B, 'ticket-b')],
          quality: 12.5,
          skillVariance: 30000,
          ratingVarianceMultiplier: 1,
          winProbability: 0.42,
          teamARating: 1500,
          teamBRating: 1600,
          maxLatency: 1,
          rematchPenalty: 0,
        },
      })
      await vi.advanceTimersByTimeAsync(0)

      await acceptFoundMatch(USER_A)
      await acceptFoundMatch(USER_B)
      // Drain the runMatch promise chain (accept -> pickMap -> draft -> doGameLoad -> loadGame).
      for (let i = 0; i < 20; i++) {
        await vi.advanceTimersByTimeAsync(0)
      }
    }

    test('with a rating only for players out of placements', async () => {
      // A has finished placements; B has played a single placement match.
      asMockedFunction(getManyMatchmakingRatings).mockImplementation(
        async (userIds: SbUserId[], type: MatchmakingType) =>
          userIds.map(id =>
            id === USER_A
              ? { ...makeMmr(id, type), rating: 1720, wins: 6, losses: 4 }
              : { ...makeMmr(id, type), rating: 1480, wins: 1, losses: 0, lifetimeGames: 1 },
          ),
      )

      await loadMatch()

      expect(getManyMatchmakingRatings).toHaveBeenCalledWith(
        expect.arrayContaining([USER_A, USER_B]),
        MatchmakingType.Match1v1,
        SEASON.id,
      )
      expect(gameLoader.loadGame).toHaveBeenCalledTimes(1)
      const request = gameLoader.loadGame.mock.calls[0][0]
      expect(request.ranks).toHaveLength(2)
      expect(request.ranks).toContainEqual({
        userId: USER_A,
        division: MatchmakingDivision.Bronze1,
        rating: 1720,
      })
      expect(request.ranks).toContainEqual({
        userId: USER_B,
        division: MatchmakingDivision.Bronze1,
        rating: undefined,
      })
    })

    test('as unrated for a player with no games in the mode', async () => {
      asMockedFunction(getManyMatchmakingRatings).mockImplementation(
        async (userIds: SbUserId[], type: MatchmakingType) =>
          userIds.map(id => ({ ...makeMmr(id, type), lifetimeGames: 0, numGamesPlayed: 0 })),
      )

      await loadMatch()

      const request = gameLoader.loadGame.mock.calls[0][0]
      expect(request.ranks).toContainEqual({
        userId: USER_A,
        division: MatchmakingDivision.Unrated,
        rating: undefined,
      })
    })

    test('loads the game without ranks when looking them up fails', async () => {
      asMockedFunction(getManyMatchmakingRatings).mockRejectedValue(new Error('db down'))

      await loadMatch()

      expect(gameLoader.loadGame).toHaveBeenCalledTimes(1)
      const request = gameLoader.loadGame.mock.calls[0][0]
      expect(request.ranks).toBeUndefined()
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
        teamA: [matched(USER_A, 'ticket-a')],
        teamB: [matched(USER_B, 'ticket-b')],
        quality: 12.5,
        skillVariance: 30000,
        ratingVarianceMultiplier: 1,
        winProbability: 0.42,
        teamARating: 1500,
        teamBRating: 1600,
        maxLatency: 1,
        rematchPenalty: 0,
      },
    })
    await vi.advanceTimersByTimeAsync(0)

    // Both players accept; the match then runs through to the (failing) game load.
    await acceptFoundMatch(USER_A)
    await acceptFoundMatch(USER_B)
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
      ratingVarianceMultiplier: 1,
      winProbability: 0.42,
      teamARating: 1500,
      teamBRating: 1600,
      teamAUserIds: [USER_A],
      teamBUserIds: [USER_B],
      teamAPlayerRatings: [1500],
      teamBPlayerRatings: [1500],
      maxLatency: 1,
      rematchPenalty: 0,
    })
  })

  describe('tells the requeued player why the game load was canceled', () => {
    const cases: Array<[description: string, error: () => unknown, reason: string]> = [
      [
        'a relay detected a game anomaly',
        () =>
          new BaseGameLoaderError(GameLoadErrorType.GameAnomaly, 'Game anomalies detected', {
            data: { userId: USER_A },
          }),
        'gameAnomaly',
      ],
      [
        'a player failed to load',
        () =>
          new BaseGameLoaderError(GameLoadErrorType.PlayerFailed, 'player failed', {
            data: { userId: USER_A },
          }),
        'playerFailedToLoad',
      ],
      [
        'a player timed out loading',
        () =>
          new BaseGameLoaderError(GameLoadErrorType.Timeout, 'timed out', {
            data: { unloaded: [USER_A] },
          }),
        'loadTimeout',
      ],
      [
        'the load timed out without blaming anyone',
        () =>
          new BaseGameLoaderError(GameLoadErrorType.Timeout, 'timed out', {
            data: { unloaded: [] },
          }),
        'setupUnresolved',
      ],
      [
        'the load failed internally',
        () => new BaseGameLoaderError(GameLoadErrorType.Internal, 'game load failed'),
        'error',
      ],
    ]

    test.each(cases)('%s', async (_description, makeError, reason) => {
      asMockedFunction(getCurrentMapPool).mockResolvedValue({ maps: [MAP_ID] } as any)
      asMockedFunction(getMapInfos).mockResolvedValue([{ id: MAP_ID } as any])
      gameLoader.loadGame.mockResolvedValue(Result.error(makeError()))

      await queuePlayer(USER_A, CLIENT_A)
      await queuePlayer(USER_B, CLIENT_B)

      redisHandler({
        type: 'matchFound',
        data: {
          mode: MatchmakingType.Match1v1,
          teamA: [matched(USER_A, 'ticket-a')],
          teamB: [matched(USER_B, 'ticket-b')],
          quality: 12.5,
          skillVariance: 30000,
          ratingVarianceMultiplier: 1,
          winProbability: 0.42,
          teamARating: 1500,
          teamBRating: 1600,
          maxLatency: 1,
          rematchPenalty: 0,
        },
      })
      await vi.advanceTimersByTimeAsync(0)

      await acceptFoundMatch(USER_A)
      await acceptFoundMatch(USER_B)
      for (let i = 0; i < 20; i++) {
        await vi.advanceTimersByTimeAsync(0)
      }

      const clientBPath = getMatchmakingClientPath(clientSockets.get(USER_B)!)
      const clientBEvents = publisher.publish.mock.calls
        .filter((call: any[]) => call[0] === clientBPath)
        .map((call: any[]) => call[1])
      expect(clientBEvents).toContainEqual({ type: 'cancelLoading', reason })
      const clientAPath = getMatchmakingClientPath(clientSockets.get(USER_A)!)
      const clientACancellation = publisher.publish.mock.calls
        .filter((call: any[]) => call[0] === clientAPath)
        .map((call: any[]) => call[1])
        .find(event => event?.type === 'cancelLoading')
      expect(clientACancellation?.penalty).toBe(reason === 'gameAnomaly' ? 'pending' : undefined)
      expect(clientBEvents.find(event => event?.type === 'cancelLoading')?.penalty).toBeUndefined()
      // A lobby violation's ban is applied from its durable evidence by `LobbyViolationService`
      expect(banUser.mock.calls.map(([userId]) => userId)).toEqual(
        reason === 'error' || reason === 'setupUnresolved' || reason === 'gameAnomaly'
          ? []
          : [USER_A],
      )
      expect(clientBEvents.findIndex(e => e?.type === 'requeue')).toBeGreaterThan(
        clientBEvents.findIndex(e => e?.type === 'cancelLoading'),
      )
    })
  })

  test('counts a found match once, not once per matched player', async () => {
    await queuePlayer(USER_A, CLIENT_A)
    await queuePlayer(USER_B, CLIENT_B)

    redisHandler({
      type: 'matchFound',
      data: {
        mode: MatchmakingType.Match1v1,
        teamA: [matched(USER_A, 'ticket-a')],
        teamB: [matched(USER_B, 'ticket-b')],
        quality: 1,
        skillVariance: 0,
        ratingVarianceMultiplier: 1,
        winProbability: 0.5,
        teamARating: 1500,
        teamBRating: 1500,
        maxLatency: 0,
        rematchPenalty: 0,
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
    matchmakerClient.queue.mockImplementationOnce(
      () =>
        new Promise<Result<void, RsMatchmakerError>>(resolve => {
          resolveBQueue = resolve
        }),
    )

    const bQueuePromise = queuePlayer(USER_B, CLIENT_B)
    // Let queueSoloPlayer for B run up to the awaited queue call.
    for (let i = 0; i < 50 && !resolveBQueue; i++) {
      await vi.advanceTimersByTimeAsync(0)
    }
    expect(resolveBQueue).toBeDefined()

    redisHandler({
      type: 'matchFound',
      data: {
        mode: MatchmakingType.Match1v1,
        teamA: [matched(USER_A, 'ticket-a')],
        teamB: [matched(USER_B, 'ticket-b')],
        quality: 1,
        skillVariance: 0,
        ratingVarianceMultiplier: 1,
        winProbability: 0.5,
        teamARating: 1500,
        teamBRating: 1500,
        maxLatency: 0,
        rematchPenalty: 0,
      },
    })
    await vi.advanceTimersByTimeAsync(0)

    // B's queue call now returns and queueSoloPlayer completes.
    resolveBQueue!(Result.ok())
    await bQueuePromise
    await vi.advanceTimersByTimeAsync(0)

    // B is in the match, so accept() works rather than throwing NoActiveMatch (which would otherwise
    // lead to an accept-timeout ban for a player who did nothing wrong).
    await expect(acceptFoundMatch(USER_B)).resolves.toBeUndefined()
    await expect(acceptFoundMatch(USER_A)).resolves.toBeUndefined()
  })

  test('sends each queued mode its recent opponents with their game ages', async () => {
    const opponentC = makeSbUserId(3)
    asMockedFunction(getRecentMatchmakingOpponents).mockResolvedValueOnce([
      {
        matchmakingType: MatchmakingType.Match1v1,
        opponentId: USER_B,
        gameStartTime: new Date(1_000_000 - 90_000),
      },
      {
        matchmakingType: MatchmakingType.Match1v1Fastest,
        opponentId: opponentC,
        gameStartTime: new Date(1_000_000 - 600_000),
      },
    ])

    await queueMultiPlayer(USER_A, CLIENT_A, [
      MatchmakingType.Match1v1,
      MatchmakingType.Match1v1Fastest,
    ])

    expect(getRecentMatchmakingOpponents).toHaveBeenCalledWith(
      USER_A,
      [MatchmakingType.Match1v1, MatchmakingType.Match1v1Fastest],
      new Date(1_000_000 - 6 * 60 * 60 * 1000),
    )
    const request = matchmakerClient.queue.mock.calls[0][0]
    const byMode = new Map(request.modeRatings.map(r => [r.mode, r.recentOpponents]))
    expect(byMode.get(MatchmakingType.Match1v1)).toEqual([{ userId: USER_B, secondsAgo: 90 }])
    expect(byMode.get(MatchmakingType.Match1v1Fastest)).toEqual([
      { userId: opponentC, secondsAgo: 600 },
    ])
  })

  test('queues without recent opponents when looking them up fails', async () => {
    asMockedFunction(getRecentMatchmakingOpponents).mockRejectedValueOnce(new Error('db down'))

    await queuePlayer(USER_A, CLIENT_A)

    expect(matchmakerClient.queue).toHaveBeenCalledTimes(1)
    const request = matchmakerClient.queue.mock.calls[0][0]
    expect(request.modeRatings[0].recentOpponents).toEqual([])
  })

  test('queues a multiqueue player with per-mode ratings and a request per mode', async () => {
    await queueMultiPlayer(USER_A, CLIENT_A, [
      MatchmakingType.Match1v1,
      MatchmakingType.Match1v1Fastest,
    ])

    // A single Rust queue call carries one rating entry per queued mode (Rust derives the queued
    // mode set from these entries).
    expect(matchmakerClient.queue).toHaveBeenCalledTimes(1)
    const request = matchmakerClient.queue.mock.calls[0][0]
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
    const request = matchmakerClient.queue.mock.calls[0][0]
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

    const request = matchmakerClient.queue.mock.calls[0][0]
    expect(request.region).toBeUndefined()
    expect(request.rttMs).toBeUndefined()
    // The player is validly queued despite the unknown region.
    await expect(service.cancel(USER_A)).resolves.toBeUndefined()
  })

  test('keeps an unmeasured region and queues with no latency signal', async () => {
    // A hand-picked region the client hasn't measured yet carries no rtt, but it still places the
    // player's relay, so it must survive the queue rather than being dropped along with the rtt.
    await queuePlayer(USER_A, CLIENT_A, { region: REGION_US_EAST, regionManual: true })

    const request = matchmakerClient.queue.mock.calls[0][0]
    expect(request.region).toBe(REGION_US_EAST)
    expect(request.rttMs).toBeUndefined()
    expect(netcodeV2Service.warmRegions).not.toHaveBeenCalled()
  })

  test('queues without a region when the client reports none', async () => {
    // A user with no coordinator-configured regions (dev loopback) reports no region and must still
    // be able to queue. The region list isn't even consulted in that case.
    await expect(queuePlayer(USER_A, CLIENT_A)).resolves.toBeUndefined()

    expect(gameServerRegionsService.getRegions).not.toHaveBeenCalled()
    const request = matchmakerClient.queue.mock.calls[0][0]
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
        teamA: [matched(USER_A, 'ticket-a')],
        teamB: [matched(USER_B, 'ticket-b')],
        quality: 1,
        skillVariance: 0,
        ratingVarianceMultiplier: 1,
        winProbability: 0.5,
        teamARating: 1500,
        teamBRating: 1500,
        maxLatency: 0,
        rematchPenalty: 0,
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
    await expect(acceptFoundMatch(USER_A)).resolves.toBeUndefined()
    await expect(acceptFoundMatch(USER_B)).resolves.toBeUndefined()
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

  test("a failed requeue doesn't end the search the player started since", async () => {
    await queuePlayer(USER_A, CLIENT_A)
    await queuePlayer(USER_B, CLIENT_B)
    // B is banned, so the match is dropped and A goes back into the queue
    checkUsers.mockResolvedValueOnce(new Set([USER_B]))
    let finishRequeue!: (result: Result<void, RsMatchmakerError>) => void
    matchmakerClient.requeue.mockImplementationOnce(
      () => new Promise(resolve => (finishRequeue = resolve)),
    )
    redisHandler({
      type: 'matchFound',
      data: {
        mode: MatchmakingType.Match1v1,
        teamA: [matched(USER_A, 'ticket-a')],
        teamB: [matched(USER_B, 'ticket-b')],
        quality: 1,
        skillVariance: 0,
        ratingVarianceMultiplier: 1,
        winProbability: 0.5,
        teamARating: 1500,
        teamBRating: 1500,
        maxLatency: 0,
        rematchPenalty: 0,
      },
    })
    await drainMatchmakingTasks()
    expect(matchmakerClient.requeue).toHaveBeenCalledWith('ticket-a')

    // A leaves the requeued search and starts another before the requeue is answered
    await service.cancel(USER_A)
    const nextSearch = queuePlayer(USER_A, CLIENT_A)
    await drainMatchmakingTasks()
    finishRequeue(Result.error(new RsMatchmakerError(RsMatchmakerErrorCode.StaleTicket, 'stale')))
    await nextSearch
    await drainMatchmakingTasks()

    expect(errorPublishedFor(USER_A)).toBe(false)
    await expect(service.cancel(USER_A)).resolves.toBeUndefined()
  })

  test("an accept for a match that fell apart doesn't accept the player's next match", async () => {
    asMockedFunction(getCurrentMapPool).mockResolvedValue({ maps: [MAP_ID] } as any)
    asMockedFunction(getMapInfos).mockResolvedValue([{ id: MAP_ID } as any])
    const USER_C = makeSbUserId(3)
    clientSockets.set(USER_C, createFakeClient(USER_C, 'CLIENT_C'))
    await queuePlayer(USER_A, CLIENT_A)
    await queuePlayer(USER_B, CLIENT_B)
    await queuePlayer(USER_C, 'CLIENT_C')
    const matchFound = (opponent: SbUserId) => ({
      type: 'matchFound' as const,
      data: {
        mode: MatchmakingType.Match1v1,
        teamA: [matched(USER_A, 'ticket-a')],
        teamB: [matched(opponent, `ticket-${opponent}`)],
        quality: 1,
        skillVariance: 0,
        ratingVarianceMultiplier: 1,
        winProbability: 0.5,
        teamARating: 1500,
        teamBRating: 1500,
        maxLatency: 0,
        rematchPenalty: 0,
      },
    })
    redisHandler(matchFound(USER_B))
    await drainMatchmakingTasks()
    const firstMatchId = foundMatchId(USER_A)

    // B leaves, so the match falls apart and A is requeued and matched again with C
    const clientB = clientSockets.get(USER_B)!
    const onCloseB = asMockedFunction(clientB.subscribe)
      .mock.calls.map(call => call[2])
      .find(callback => typeof callback === 'function')!
    onCloseB(clientB)
    await drainMatchmakingTasks()
    redisHandler(matchFound(USER_C))
    await drainMatchmakingTasks()
    expect(foundMatchId(USER_A)).not.toBe(firstMatchId)

    // A readied up for the first match, but the request only arrives now
    await expect(service.accept(USER_A, firstMatchId)).rejects.toThrow('No active match')
    await acceptFoundMatch(USER_C)
    await vi.advanceTimersByTimeAsync(120_000)

    expect(banUser).toHaveBeenCalledWith(USER_A, expect.anything())
    expect(banUser).not.toHaveBeenCalledWith(USER_C, expect.anything())
  })

  test('a match proposed while a player was in another one stays dropped once they requeue', async () => {
    const USER_C = makeSbUserId(3)
    clientSockets.set(USER_C, createFakeClient(USER_C, 'CLIENT_C'))
    await queuePlayer(USER_A, CLIENT_A)
    await queuePlayer(USER_B, CLIENT_B)
    await queuePlayer(USER_C, 'CLIENT_C')
    const matchFound = (opponent: SbUserId) => ({
      type: 'matchFound' as const,
      data: {
        mode: MatchmakingType.Match1v1,
        teamA: [matched(USER_A, 'ticket-a')],
        teamB: [matched(opponent, `ticket-${opponent}`)],
        quality: 1,
        skillVariance: 0,
        ratingVarianceMultiplier: 1,
        winProbability: 0.5,
        teamARating: 1500,
        teamBRating: 1500,
        maxLatency: 0,
        rematchPenalty: 0,
      },
    })
    redisHandler(matchFound(USER_B))
    await drainMatchmakingTasks()

    // A proposal that includes A, who is already in a match, is checked for bans
    let finishBanCheck!: (banned: Set<SbUserId>) => void
    checkUsers.mockReturnValueOnce(new Promise(resolve => (finishBanCheck = resolve)))
    redisHandler(matchFound(USER_C))
    await drainMatchmakingTasks()

    // Meanwhile B leaves, so A's match falls apart and A is requeued
    const clientB = clientSockets.get(USER_B)!
    const onCloseB = asMockedFunction(clientB.subscribe)
      .mock.calls.map(call => call[2])
      .find(callback => typeof callback === 'function')!
    onCloseB(clientB)
    await drainMatchmakingTasks()
    expect(matchmakerClient.requeue).toHaveBeenCalledWith('ticket-a')

    finishBanCheck(new Set())
    await drainMatchmakingTasks()

    expect(matchmakerClient.requeue).toHaveBeenCalledWith(`ticket-${USER_C}`)
    await expect(acceptFoundMatch(USER_C)).rejects.toThrow('No active match')
    await expect(service.cancel(USER_A)).resolves.toBeUndefined()
  })

  test('keeps an active-banned player out of a match found concurrently', async () => {
    await queuePlayer(USER_A, CLIENT_A)
    await queuePlayer(USER_B, CLIENT_B)
    checkUsers.mockResolvedValue(new Set([USER_A]))

    redisHandler({
      type: 'matchFound',
      data: {
        mode: MatchmakingType.Match1v1,
        teamA: [matched(USER_A, 'ticket-a')],
        teamB: [matched(USER_B, 'ticket-b')],
        quality: 1,
        skillVariance: 0,
        ratingVarianceMultiplier: 1,
        winProbability: 0.5,
        teamARating: 1500,
        teamBRating: 1500,
        maxLatency: 0,
        rematchPenalty: 0,
      },
    })
    await drainMatchmakingTasks()

    expect(checkUsers).toHaveBeenCalledWith([USER_A, USER_B])
    expect(matchmakerClient.requeue).toHaveBeenCalledWith('ticket-b')
    await expect(acceptFoundMatch(USER_B)).rejects.toThrow()
  })

  test('evicts a banned player from an accepting replacement match without banning peers', async () => {
    await queuePlayer(USER_A, CLIENT_A)
    await queuePlayer(USER_B, CLIENT_B)
    checkUser.mockResolvedValue({})

    redisHandler({
      type: 'matchFound',
      data: {
        mode: MatchmakingType.Match1v1,
        teamA: [matched(USER_A, 'ticket-a')],
        teamB: [matched(USER_B, 'ticket-b')],
        quality: 1,
        skillVariance: 0,
        ratingVarianceMultiplier: 1,
        winProbability: 0.5,
        teamARating: 1500,
        teamBRating: 1500,
        maxLatency: 0,
        rematchPenalty: 0,
      },
    })
    await drainMatchmakingTasks()

    await service.enforceLobbyViolationPenalty({
      gameId: 'late-game',
      userId: USER_A,
      penalty: 'lossAndBan',
    })
    await drainMatchmakingTasks()

    expect(banUser).not.toHaveBeenCalled()
    expect(publisher.publish).toHaveBeenCalledWith(getMatchmakingUserPath(USER_A), {
      type: 'lobbyViolationPenalty',
      gameId: 'late-game',
      penalty: 'lossAndBan',
      queueRemoved: true,
    })
    expect(matchmakerClient.requeue).toHaveBeenCalledWith('ticket-b')
  })

  test('cancels a loading replacement before evicting the banned player', async () => {
    asMockedFunction(getCurrentMapPool).mockResolvedValue({ maps: [MAP_ID] } as any)
    asMockedFunction(getMapInfos).mockResolvedValue([{ id: MAP_ID } as any])
    let resolveLoad: ((result: Result<any, any>) => void) | undefined
    gameLoader.loadGame.mockImplementation((request: any) => {
      request.onGameRegistered('replacement-game')
      return new Promise(resolve => {
        resolveLoad = resolve
      })
    })
    await queuePlayer(USER_A, CLIENT_A)
    await queuePlayer(USER_B, CLIENT_B)
    checkUser.mockResolvedValue({})

    redisHandler({
      type: 'matchFound',
      data: {
        mode: MatchmakingType.Match1v1,
        teamA: [matched(USER_A, 'ticket-a')],
        teamB: [matched(USER_B, 'ticket-b')],
        quality: 1,
        skillVariance: 0,
        ratingVarianceMultiplier: 1,
        winProbability: 0.5,
        teamARating: 1500,
        teamBRating: 1500,
        maxLatency: 0,
        rematchPenalty: 0,
      },
    })
    await drainMatchmakingTasks()
    await acceptFoundMatch(USER_A)
    await acceptFoundMatch(USER_B)
    await drainMatchmakingTasks()

    const enforcing = service.enforceLobbyViolationPenalty({
      gameId: 'late-game',
      userId: USER_A,
      penalty: 'lossAndBan',
    })
    await drainMatchmakingTasks()
    expect(gameLoader.cancelLoadingWithoutBlame).toHaveBeenCalledWith('replacement-game')
    resolveLoad!(Result.error(new BaseGameLoaderError(GameLoadErrorType.Canceled, 'canceled')))
    await enforcing

    expect(banUser).not.toHaveBeenCalled()
    expect(matchmakerClient.requeue).toHaveBeenCalledWith('ticket-b')
  })

  test("leaves a loading game to its relay evidence when a player's site socket drops", async () => {
    asMockedFunction(getCurrentMapPool).mockResolvedValue({ maps: [MAP_ID] } as any)
    asMockedFunction(getMapInfos).mockResolvedValue([{ id: MAP_ID } as any])
    let request: any
    gameLoader.loadGame.mockImplementation((loadRequest: any) => {
      request = loadRequest
      loadRequest.onGameRegistered('loading-game')
      return new Promise<never>(() => {})
    })
    await queuePlayer(USER_A, CLIENT_A)
    await queuePlayer(USER_B, CLIENT_B)

    redisHandler({
      type: 'matchFound',
      data: {
        mode: MatchmakingType.Match1v1,
        teamA: [matched(USER_A, 'ticket-a')],
        teamB: [matched(USER_B, 'ticket-b')],
        quality: 1,
        skillVariance: 0,
        ratingVarianceMultiplier: 1,
        winProbability: 0.5,
        teamARating: 1500,
        teamBRating: 1500,
        maxLatency: 0,
        rematchPenalty: 0,
      },
    })
    await drainMatchmakingTasks()
    await acceptFoundMatch(USER_A)
    await acceptFoundMatch(USER_B)
    await drainMatchmakingTasks()
    expect(request).toBeDefined()

    const clientA = clientSockets.get(USER_A)!
    const onClose = asMockedFunction(clientA.subscribe)
      .mock.calls.map(call => call[2])
      .find(callback => typeof callback === 'function')!
    onClose(clientA)
    await drainMatchmakingTasks()

    expect(request.signal.aborted).toBe(false)
    expect(banUser).not.toHaveBeenCalled()
    // The loading match still owns the player, so they can't start a search its cleanup would undo
    await expect(queuePlayer(USER_A, CLIENT_A)).rejects.toThrow()
  })

  test("doesn't requeue a player whose site socket dropped during a load that then failed", async () => {
    asMockedFunction(getCurrentMapPool).mockResolvedValue({ maps: [MAP_ID] } as any)
    asMockedFunction(getMapInfos).mockResolvedValue([{ id: MAP_ID } as any])
    let resolveLoad: ((result: Result<any, any>) => void) | undefined
    gameLoader.loadGame.mockImplementation((loadRequest: any) => {
      loadRequest.onGameRegistered('failing-game')
      return new Promise(resolve => {
        resolveLoad = resolve
      })
    })
    await queuePlayer(USER_A, CLIENT_A)
    await queuePlayer(USER_B, CLIENT_B)

    redisHandler({
      type: 'matchFound',
      data: {
        mode: MatchmakingType.Match1v1,
        teamA: [matched(USER_A, 'ticket-a')],
        teamB: [matched(USER_B, 'ticket-b')],
        quality: 1,
        skillVariance: 0,
        ratingVarianceMultiplier: 1,
        winProbability: 0.5,
        teamARating: 1500,
        teamBRating: 1500,
        maxLatency: 0,
        rematchPenalty: 0,
      },
    })
    await drainMatchmakingTasks()
    await acceptFoundMatch(USER_A)
    await acceptFoundMatch(USER_B)
    await drainMatchmakingTasks()

    const clientA = clientSockets.get(USER_A)!
    const onClose = asMockedFunction(clientA.subscribe)
      .mock.calls.map(call => call[2])
      .find(callback => typeof callback === 'function')!
    onClose(clientA)
    resolveLoad!(Result.error(new BaseGameLoaderError(GameLoadErrorType.Internal, 'failed')))
    await drainMatchmakingTasks()

    expect(matchmakerClient.requeue).toHaveBeenCalledWith('ticket-b')
    expect(matchmakerClient.requeue).not.toHaveBeenCalledWith('ticket-a')
    // Released with the match, so a fresh search works
    await queuePlayer(USER_A, CLIENT_A)
  })

  test('does not abort a replacement game that already started', async () => {
    asMockedFunction(getCurrentMapPool).mockResolvedValue({ maps: [MAP_ID] } as any)
    asMockedFunction(getMapInfos).mockResolvedValue([{ id: MAP_ID } as any])
    let request: any
    gameLoader.loadGame.mockImplementation((loadRequest: any) => {
      request = loadRequest
      loadRequest.onGameRegistered('started-game')
      return new Promise<never>(() => {})
    })
    gameLoader.cancelLoadingWithoutBlame.mockReturnValue(false)
    await queuePlayer(USER_A, CLIENT_A)
    await queuePlayer(USER_B, CLIENT_B)
    checkUser.mockResolvedValue({})

    redisHandler({
      type: 'matchFound',
      data: {
        mode: MatchmakingType.Match1v1,
        teamA: [matched(USER_A, 'ticket-a')],
        teamB: [matched(USER_B, 'ticket-b')],
        quality: 1,
        skillVariance: 0,
        ratingVarianceMultiplier: 1,
        winProbability: 0.5,
        teamARating: 1500,
        teamBRating: 1500,
        maxLatency: 0,
        rematchPenalty: 0,
      },
    })
    await drainMatchmakingTasks()
    await acceptFoundMatch(USER_A)
    await acceptFoundMatch(USER_B)
    await drainMatchmakingTasks()

    await service.enforceLobbyViolationPenalty({
      gameId: 'late-game',
      userId: USER_A,
      penalty: 'lossAndBan',
    })

    expect(gameLoader.cancelLoadingWithoutBlame).toHaveBeenCalledWith('started-game')
    expect(request.signal.aborted).toBe(false)
    expect(banUser).not.toHaveBeenCalled()
  })

  describe('a penalty that removes a search', () => {
    let finishCancel: (result: Result<void, RsMatchmakerError>) => void

    beforeEach(async () => {
      await queuePlayer(USER_A, CLIENT_A)
      checkUser.mockResolvedValue({})
      matchmakerClient.cancel.mockImplementationOnce(
        () => new Promise(resolve => (finishCancel = resolve)),
      )
    })

    /** The player's client goes away, and they come back and join a lobby. */
    async function leaveForLobby(): Promise<ClientSocketsGroup> {
      const clientA = clientSockets.get(USER_A)!
      const onClose = asMockedFunction(clientA.subscribe)
        .mock.calls.map(call => call[2])
        .find(callback => typeof callback === 'function')!
      onClose(clientA)
      const lobbyClient = createFakeClient(USER_A, 'CLIENT_A2')
      expect(
        activityRegistry.registerActiveClient(USER_A, lobbyClient, FriendActivityStatus.InLobby),
      ).toBe(true)
      return lobbyClient
    }

    test('leaves alone a lobby the player joins while it is being removed', async () => {
      const enforcing = service.enforceLobbyViolationPenalty({
        gameId: 'other-game',
        userId: USER_A,
        penalty: 'lossAndBan',
      })
      await drainMatchmakingTasks()
      const lobbyClient = await leaveForLobby()

      finishCancel(Result.ok())
      await enforcing

      expect(activityRegistry.getClientForUser(USER_A)).toBe(lobbyClient)
    })

    test("doesn't bring the search back for a player who has left, if removing it fails", async () => {
      const enforcing = service.enforceLobbyViolationPenalty({
        gameId: 'other-game',
        userId: USER_A,
        penalty: 'lossAndBan',
      })
      await drainMatchmakingTasks()
      const lobbyClient = await leaveForLobby()

      finishCancel(
        Result.error(new RsMatchmakerError(RsClientErrorCode.ServiceUnavailable, 'boom')),
      )
      await expect(enforcing).rejects.toThrow('boom')

      expect(activityRegistry.getClientForUser(USER_A)).toBe(lobbyClient)
      await expect(acceptFoundMatch(USER_A)).rejects.toThrow('No active match')
      await expect(service.cancel(USER_A)).rejects.toThrow('does not have an active')
    })
  })

  describe('simulated match pops', () => {
    const IDENTIFIERS = [[1, 'a'.repeat(64)]] as any

    function clientEvents(userId: SbUserId): any[] {
      const path = getMatchmakingClientPath(clientSockets.get(userId)!)
      return publisher.publish.mock.calls
        .filter((call: any[]) => call[0] === path)
        .map((call: any[]) => call[1])
    }

    function foundMatchEvent(userId: SbUserId): any {
      const subscribe = asMockedFunction(clientSockets.get(userId)!.subscribe)
      const call = subscribe.mock.calls.find(([path]) => path.startsWith(getMatchPath('')))
      return (call?.[1] as any)?.(clientSockets.get(userId))
    }

    async function startSearch() {
      const prefs = makePreferences()
      await service.find(USER_A, CLIENT_A, IDENTIFIERS, [prefs], DEFAULT_PUBKEY)
      matchmakerClient.queue.mockClear()
    }

    test('shows the player a match with an unaccepted slot', async () => {
      await startSearch()

      await service.simulateMatchPop(USER_A)
      await drainMatchmakingTasks()

      expect(matchmakerClient.cancel).toHaveBeenCalledWith(USER_A)
      expect(foundMatchEvent(USER_A)).toMatchObject({
        type: 'matchFound',
        matchmakingType: MatchmakingType.Match1v1,
        numPlayers: 2,
        acceptedPlayers: 0,
        hasAccepted: false,
      })
      await expect(service.cancel(USER_A)).rejects.toThrow('cannot be canceled')
    })

    test('requeues a player who accepted once the accept time runs out', async () => {
      await startSearch()
      const completionsBefore = asMockedFunction(insertMatchmakingCompletion).mock.calls.length

      await service.simulateMatchPop(USER_A)
      await drainMatchmakingTasks()
      await acceptFoundMatch(USER_A)
      await drainMatchmakingTasks()
      expect(clientEvents(USER_A)).not.toContainEqual({ type: 'requeue' })

      await vi.advanceTimersByTimeAsync(120_000)

      expect(clientEvents(USER_A)).toContainEqual({ type: 'requeue' })
      expect(matchmakerClient.queue).toHaveBeenCalledTimes(1)
      expect(matchmakerClient.queue.mock.calls[0][0]).toMatchObject({ id: USER_A })
      expect(banUser).not.toHaveBeenCalled()
      expect(gameLoader.loadGame).not.toHaveBeenCalled()
      expect(insertMatchmakingMatchFormation).not.toHaveBeenCalled()
      expect(asMockedFunction(insertMatchmakingCompletion).mock.calls.length).toBe(
        completionsBefore,
      )
      // Searching again, so a cancel now ends the search instead of hitting a starting match
      await expect(service.cancel(USER_A)).resolves.toBeUndefined()
    })

    test('bans a player who never accepts, and nobody else', async () => {
      await startSearch()

      await service.simulateMatchPop(USER_A)
      await drainMatchmakingTasks()
      await vi.advanceTimersByTimeAsync(120_000)

      expect(clientEvents(USER_A)).toContainEqual({ type: 'acceptTimeout' })
      expect(clientEvents(USER_A)).not.toContainEqual({ type: 'requeue' })
      expect(banUser.mock.calls).toEqual([[USER_A, IDENTIFIERS]])
      expect(matchmakerClient.queue).not.toHaveBeenCalled()
      await expect(service.cancel(USER_A)).rejects.toThrow('does not have an active')
    })

    test('bans a player who disconnects during the accept phase', async () => {
      await startSearch()
      await service.simulateMatchPop(USER_A)
      await drainMatchmakingTasks()

      const client = clientSockets.get(USER_A)!
      const searchSubscription = asMockedFunction(client.subscribe).mock.calls.find(
        ([path]) => path === getMatchmakingClientPath(client),
      )!
      ;(searchSubscription[2] as any)(client)
      await drainMatchmakingTasks()

      expect(banUser.mock.calls).toEqual([[USER_A, IDENTIFIERS]])
      expect(matchmakerClient.queue).not.toHaveBeenCalled()
    })

    test.each([
      { name: 'before the player accepts', accept: false },
      { name: 'after the player accepts', accept: true },
    ])('requeues without a ban when the opponent leaves $name', async ({ accept }) => {
      await startSearch()

      await service.simulateMatchPop(USER_A, { opponentLeavesAfterMs: 10_000 })
      await drainMatchmakingTasks()
      if (accept) await acceptFoundMatch(USER_A)
      await vi.advanceTimersByTimeAsync(9_000)
      expect(clientEvents(USER_A)).not.toContainEqual({ type: 'requeue' })
      await vi.advanceTimersByTimeAsync(1_000)

      expect(clientEvents(USER_A)).toContainEqual({ type: 'requeue' })
      expect(banUser).not.toHaveBeenCalled()
      expect(matchmakerClient.queue).toHaveBeenCalledTimes(1)
    })

    test('fills every other slot of a team mode with simulated players', async () => {
      const prefs = makePreferences()
      prefs.matchmakingType = MatchmakingType.Match2v2
      await service.find(USER_A, CLIENT_A, IDENTIFIERS, [prefs], DEFAULT_PUBKEY)

      await service.simulateMatchPop(USER_A)
      await drainMatchmakingTasks()
      await acceptFoundMatch(USER_A)
      await vi.advanceTimersByTimeAsync(120_000)

      expect(foundMatchEvent(USER_A)).toMatchObject({ numPlayers: 4 })
      expect(clientEvents(USER_A)).toContainEqual({ type: 'requeue' })
      expect(banUser).not.toHaveBeenCalled()
    })

    test('refuses a player who is not searching', async () => {
      await expect(service.simulateMatchPop(USER_A)).rejects.toThrow('active matchmaking search')

      await startSearch()
      await service.simulateMatchPop(USER_A)
      await drainMatchmakingTasks()
      await expect(service.simulateMatchPop(USER_A)).rejects.toThrow('active matchmaking search')
    })

    test('refuses a banned player and leaves their search alone', async () => {
      await startSearch()
      checkUser.mockResolvedValue({})

      await expect(service.simulateMatchPop(USER_A)).rejects.toThrow('banned')

      expect(matchmakerClient.cancel).not.toHaveBeenCalled()
      await expect(service.cancel(USER_A)).resolves.toBeUndefined()
    })

    test('leaves a search the player canceled while it was leaving the matchmaker', async () => {
      await startSearch()
      let finishCancel!: () => void
      matchmakerClient.cancel.mockImplementationOnce(
        () => new Promise(resolve => (finishCancel = () => resolve(Result.ok()))),
      )

      const simulated = service.simulateMatchPop(USER_A)
      await drainMatchmakingTasks()
      await service.cancel(USER_A)
      finishCancel()
      await simulated
      await drainMatchmakingTasks()

      expect(foundMatchEvent(USER_A)).toBeUndefined()
      expect(matchmakerClient.queue).not.toHaveBeenCalled()
    })
  })
})
