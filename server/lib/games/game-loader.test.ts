import { register } from '@prometheus-io/client'
import { container } from 'tsyringe'
import { afterEach, beforeEach, describe, expect, Mock, test, vi } from 'vitest'
import { timeoutPromise } from '../../../common/async/timeout-promise'
import { makeGameServerRegionId } from '../../../common/game-server-regions'
import {
  GameConfig,
  GameConfigPlayer,
  GameSource,
  LobbyExtra,
  LobbyGameConfig,
} from '../../../common/games/configuration'
import { PlayerInfo } from '../../../common/games/game-launch-config'
import { GameType } from '../../../common/games/game-type'
import { SlotType } from '../../../common/lobbies/slot'
import { makeSbMapId, MapInfo, MapVisibility } from '../../../common/maps'
import { MatchmakingType } from '../../../common/matchmaking'
import { BwUserLatency } from '../../../common/network'
import { asMockedFunction } from '../../../common/testing/mocks'
import { SbUser } from '../../../common/users/sb-user'
import { makeSbUserId, SbUserId } from '../../../common/users/sb-user-id'
import { getMapInfos } from '../maps/map-models'
import { findUsersById } from '../users/user-model'
import {
  BaseGameLoaderError,
  GameLoader,
  GameLoadErrorType,
  GameLoadPlayer,
  GameLoadRequest,
  LOBBY_VIOLATION_STAGER,
} from './game-loader'
import { cancelGame, finalizeGameSetupCancellation, updateGameConfig } from './game-models'
import { registerGame } from './registration'

vi.mock('./registration', () => ({
  registerGame: vi.fn(),
}))
vi.mock('./game-models', () => ({
  updateGameConfig: vi.fn().mockResolvedValue(undefined),
  cancelGame: vi.fn().mockResolvedValue(undefined),
  finalizeGameSetupCancellation: vi.fn().mockResolvedValue(true),
}))
vi.mock('../maps/map-models', () => ({
  getMapInfos: vi.fn(),
}))
vi.mock('../users/user-model', () => ({
  findUsersById: vi.fn(),
}))
// The loader budgets its post-deadline pulls on the monotonic clock, which the fake timers don't
// drive; reading it off the faked wall clock keeps the two in step for these tests.
vi.mock('../time/monotonic-now', () => ({
  monotonicNow: () => Date.now(),
}))

const p1 = makeSbUserId(1)
const p2 = makeSbUserId(2)
const mapId = makeSbMapId('1')

/** How long a load has to finish before the loader starts deciding whether anyone is at fault. */
const LOAD_DEADLINE_MS = 75_000
/**
 * How long past that deadline the loader can keep asking the coordinator for an attested record
 * before it gives up on attributing the failure.
 */
const ATTEST_BUDGET_MS = 20_000
/** How long the loader waits between pulls that weren't attested. */
const ATTEST_POLL_MS = 2_000

function lobbyConfig(teams: GameConfigPlayer[][]): LobbyGameConfig {
  return {
    gameSource: GameSource.Lobby,
    gameType: GameType.Melee,
    gameSubType: 0,
    teams,
  }
}

function makePlayer(userId: SbUserId): { player: GameLoadPlayer; playerInfo: PlayerInfo } {
  return {
    player: { userId, isObserver: false },
    playerInfo: {
      id: `slot-${userId}`,
      userId,
      race: 'r',
      playerId: 0,
      teamId: 0,
      type: SlotType.Human,
      typeId: 6,
    },
  }
}

function makeUser(userId: SbUserId): SbUser {
  return { id: userId, name: `user-${userId}`, created: 0 }
}

function makeMapInfo(): MapInfo {
  return {
    id: mapId,
    hash: 'hash',
    name: 'Test Map',
    description: '',
    publishedBy: p1,
    publishedAt: new Date(0),
    visibility: MapVisibility.Public,
    mapData: {} as any,
    imageVersion: 1,
    imageSpawnsBaked: true,
  }
}

function makeClient(userId: SbUserId) {
  return {
    userId,
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
  }
}

describe('games/game-loader/GameLoader', () => {
  let publisher: { publish: ReturnType<typeof vi.fn> }
  let activityRegistry: { getClientForUser: ReturnType<typeof vi.fn> }
  let restrictionService: { checkMultipleRestrictions: ReturnType<typeof vi.fn> }
  let netcodeV2Service: {
    isEnabled: ReturnType<typeof vi.fn>
    createSessionForGame: Mock<
      (args: {
        gameId: string
        slots: Array<{
          slot: number
          userId: SbUserId
          observer: boolean
          region?: unknown
          rttMs?: number
          pubkey?: string
        }>
        canRollBack?: boolean
        signal: AbortSignal
        onProvisioning?: (regions: string[]) => void
      }) => Promise<{ session: number; setups: Map<SbUserId, unknown> }>
    >
    fetchSessionLoadState: Mock<
      (
        session: number,
        options?: { timeoutMs?: number },
      ) => Promise<{
        known: boolean
        setupFinal?: boolean
        lobbyViolationSlots?: number[]
        startedAtMs?: number
        connectedSlots: number[]
        startedSlots: number[]
        forwardedSlots?: number[]
        turnsKnown?: boolean
        closedSlots?: Array<{ slot: number; epoch?: string }>
        liveSlots?: number[]
        closedKnown?: boolean
      }>
    >
  }
  let activityStatusService: { setInGame: ReturnType<typeof vi.fn> }
  let gameLoader: GameLoader

  beforeEach(() => {
    vi.clearAllMocks()
    register.clear()

    asMockedFunction(getMapInfos).mockResolvedValue([makeMapInfo()])
    asMockedFunction(cancelGame).mockResolvedValue(undefined)
    asMockedFunction(finalizeGameSetupCancellation).mockResolvedValue(true)
    asMockedFunction(updateGameConfig).mockResolvedValue(undefined)

    publisher = { publish: vi.fn() }
    activityRegistry = { getClientForUser: vi.fn() }
    restrictionService = { checkMultipleRestrictions: vi.fn().mockResolvedValue([]) }
    netcodeV2Service = {
      isEnabled: vi.fn().mockReturnValue(true),
      createSessionForGame: vi.fn().mockResolvedValue({ session: 1, setups: new Map() }),
      // A coordinator that holds nothing for the session by default, so a test says what evidence
      // the pull contributes rather than inheriting some.
      fetchSessionLoadState: vi
        .fn()
        .mockResolvedValue({ known: false, connectedSlots: [], startedSlots: [] }),
    }
    activityStatusService = { setInGame: vi.fn() }

    gameLoader = new GameLoader(
      publisher as any,
      activityRegistry as any,
      restrictionService as any,
      {
        ...netcodeV2Service,
        // A pull that says nothing about forwarded turns or closed slots reads like a coordinator
        // that doesn't track them, so only a test that cares has to mention them.
        fetchSessionLoadState: async (session: number, options?: { timeoutMs?: number }) => ({
          forwardedSlots: [],
          turnsKnown: false,
          closedSlots: [],
          liveSlots: [],
          closedKnown: false,
          ...(await netcodeV2Service.fetchSessionLoadState(session, options)),
        }),
      } as any,
      activityStatusService as any,
    )
  })

  function registerActiveClients(players: GameLoadPlayer[]) {
    activityRegistry.getClientForUser.mockImplementation((userId: SbUserId) =>
      players.some(p => p.userId === userId) ? makeClient(userId) : undefined,
    )
  }

  /**
   * Starts a two-human (networked) load and drains its asynchronous setup, so the relay session and
   * its slot assignment are on the load before a test crosses the deadline. Slots follow player
   * order, making p1 slot 0 and p2 slot 1. The pending load is returned wrapped, since an
   * `AsyncResult` is itself thenable and would otherwise be awaited away by this helper.
   */
  async function startNetworkedLoad(
    gameId: string,
    matchmaking = false,
    lobbyExtra?: LobbyExtra,
    developmentUser?: SbUserId,
  ) {
    const player1 = makePlayer(p1)
    const player2 = makePlayer(p2)
    registerActiveClients([player1.player, player2.player])
    if (developmentUser !== undefined) {
      activityRegistry.getClientForUser.mockImplementation((userId: SbUserId) => ({
        ...makeClient(userId),
        developmentClient: userId === developmentUser,
      }))
    }
    asMockedFunction(findUsersById).mockResolvedValue([makeUser(p1), makeUser(p2)])
    netcodeV2Service.isEnabled.mockReturnValue(true)
    netcodeV2Service.createSessionForGame.mockResolvedValue({
      session: 77,
      setups: new Map([
        [p1, {} as any],
        [p2, {} as any],
      ]),
    })

    asMockedFunction(registerGame).mockResolvedValue({
      gameId,
      resultCodes: new Map([
        [p1, 'code-1'],
        [p2, 'code-2'],
      ]),
    } as any)

    const load = gameLoader.loadGame({
      players: [player1.player, player2.player],
      playerInfos: [player1.playerInfo, player2.playerInfo],
      mapId,
      gameConfig: {
        ...lobbyConfig([
          [{ id: p1, race: 't', isComputer: false }],
          [{ id: p2, race: 'z', isComputer: false }],
        ]),
        ...(lobbyExtra ? { gameSourceExtra: lobbyExtra } : {}),
        ...(matchmaking
          ? {
              gameSource: GameSource.Matchmaking as const,
              gameSourceExtra: { type: MatchmakingType.Match1v1 },
            }
          : {}),
      } as GameConfig,
    })

    // Every awaited step of the setup resolves on an already-resolved promise, so draining the
    // microtask queue is enough to get the load fully armed.
    for (let i = 0; i < 100; i++) {
      await Promise.resolve()
    }

    return { load }
  }

  /**
   * Starts a networked lobby load for `roster`, in order, and drains its setup like
   * `startNetworkedLoad`. The first player hosts, so slots follow roster order.
   */
  async function startRosterLoad(gameId: string, roster: GameLoadPlayer[]) {
    const entries = roster.map(player => ({
      player,
      playerInfo: makePlayer(player.userId).playerInfo,
    }))
    registerActiveClients(roster)
    asMockedFunction(findUsersById).mockResolvedValue(roster.map(p => makeUser(p.userId)))
    netcodeV2Service.isEnabled.mockReturnValue(true)
    netcodeV2Service.createSessionForGame.mockResolvedValue({
      session: 77,
      setups: new Map(roster.map(p => [p.userId, {} as any])),
    })
    asMockedFunction(registerGame).mockResolvedValue({
      gameId,
      resultCodes: new Map(roster.map(p => [p.userId, `code-${p.userId}`])),
    } as any)

    const load = gameLoader.loadGame({
      players: roster,
      playerInfos: entries.map(e => e.playerInfo),
      mapId,
      gameConfig: lobbyConfig([
        roster.map(p => ({ id: p.userId, race: 'r' as const, isComputer: false })),
      ]),
    })
    for (let i = 0; i < 100; i++) {
      await Promise.resolve()
    }
    return { load }
  }

  test.each([false, true])(
    'copies the active client mode per player (matchmaking=%s)',
    async matchmaking => {
      const gameId = `development-${matchmaking}`
      const { load } = await startNetworkedLoad(gameId, matchmaking, undefined, p1)
      await vi.waitFor(() => expect(netcodeV2Service.createSessionForGame).toHaveBeenCalledTimes(1))
      const slots = netcodeV2Service.createSessionForGame.mock.calls[0][0].slots
      expect(slots.find(s => s.userId === p1)).toHaveProperty('developmentClient', true)
      expect(slots.find(s => s.userId === p2)).not.toHaveProperty('developmentClient')
      gameLoader.registerGameAsLoaded(gameId, p1)
      gameLoader.registerGameAsLoaded(gameId, p2)
      await load
    },
  )

  /** Whether any player was told their load was being cancelled. */
  function wasCancelPublished() {
    return publisher.publish.mock.calls.some((call: any[]) => call[1]?.type === 'cancelLoading')
  }

  /**
   * Runs a load past its deadline and past the whole window the loader spends waiting for a
   * coordinator record complete enough to attribute a failure, then returns the timeout error it
   * was cancelled with.
   */
  async function expectTimeout(load: Promise<any>) {
    await vi.advanceTimersByTimeAsync(LOAD_DEADLINE_MS + ATTEST_BUDGET_MS + 5_000)
    const result = await load
    expect(result.isError()).toBe(true)
    const error = result.errorOrNull() as BaseGameLoaderError<GameLoadErrorType.Timeout>
    expect(error.code).toBe(GameLoadErrorType.Timeout)
    return error
  }

  describe('lobby violations', () => {
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())

    test('cancels a custom game without a penalty and retains its cancellation reason', async () => {
      const { load } = await startNetworkedLoad('custom-anomaly')
      const penalty = vi.fn()
      await gameLoader.cancelLoadingForLobbyViolation(
        'custom-anomaly',
        77,
        1,
        p2,
        new Date(),
        penalty,
      )
      expect((await load).errorOrNull()?.code).toBe(GameLoadErrorType.GameAnomaly)
      expect(penalty).not.toHaveBeenCalled()
      expect(cancelGame).toHaveBeenCalledWith('custom-anomaly', 'gameAnomaly')
    })

    test('blocks competing outcomes and releases without blame when evidence staging fails', async () => {
      const { load } = await startNetworkedLoad('ranked-anomaly', true)
      let reject!: (err: Error) => void
      const penalty = vi.fn(
        () =>
          new Promise<void>((_, r) => {
            reject = r
          }),
      )
      const processing = gameLoader.cancelLoadingForLobbyViolation(
        'ranked-anomaly',
        77,
        1,
        p2,
        new Date(),
        penalty,
      )
      expect(gameLoader.registerGameAsLoaded('ranked-anomaly', p1)).toBe(false)
      expect(gameLoader.maybeCancelLoading('ranked-anomaly', p1)).toBe(false)
      expect(wasCancelPublished()).toBe(false)
      reject(new Error('database unavailable'))
      expect(await processing).toBe(true)
      expect((await load).errorOrNull()?.code).toBe(GameLoadErrorType.Internal)
      expect(gameLoader.isLoading('ranked-anomaly')).toBe(false)
    })

    test('a hung evidence write cannot keep a claimed load open past the resolution budget', async () => {
      const { load } = await startNetworkedLoad('hung-evidence', true)
      let finish!: () => void
      const penalty = vi.fn(
        () =>
          new Promise<void>(resolve => {
            finish = resolve
          }),
      )
      const processing = gameLoader.cancelLoadingForLobbyViolation(
        'hung-evidence',
        77,
        1,
        p2,
        new Date(),
        penalty,
      )
      await vi.advanceTimersByTimeAsync(ATTEST_BUDGET_MS - 1)
      expect(wasCancelPublished()).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      expect(await processing).toBe(true)
      expect((await load).errorOrNull()?.code).toBe(GameLoadErrorType.Internal)
      expect(gameLoader.isLoading('hung-evidence')).toBe(false)
      finish()
      await vi.advanceTimersByTimeAsync(1)
      expect(cancelGame).toHaveBeenCalledTimes(1)
    })

    test('duplicate evidence shares one staging attempt and preserves the first claim', async () => {
      const { load } = await startNetworkedLoad('duplicate-evidence', true)
      let finish!: () => void
      const penalty = vi.fn(
        () =>
          new Promise<void>(resolve => {
            finish = resolve
          }),
      )
      const first = gameLoader.cancelLoadingForLobbyViolation(
        'duplicate-evidence',
        77,
        1,
        p2,
        new Date(123),
        penalty,
      )
      const duplicate = gameLoader.cancelLoadingForLobbyViolation(
        'duplicate-evidence',
        77,
        1,
        p2,
        new Date(456),
        penalty,
      )
      expect(duplicate).toBe(first)
      expect(penalty).toHaveBeenCalledTimes(1)
      finish()
      await first
      expect((await load).errorOrNull()?.code).toBe(GameLoadErrorType.GameAnomaly)
    })

    test('rejects mismatched session, slot, user, and already loaded games', async () => {
      const { load } = await startNetworkedLoad('identity-anomaly', true)
      const penalty = vi.fn()
      for (const [session, slot, user] of [
        [78, 1, p2],
        [77, 0, p2],
        [77, 1, makeSbUserId(3)],
      ]) {
        await gameLoader.cancelLoadingForLobbyViolation(
          'identity-anomaly',
          session,
          slot,
          user as SbUserId,
          new Date(),
          penalty,
        )
      }
      expect(penalty).not.toHaveBeenCalled()
      expect(wasCancelPublished()).toBe(false)
      gameLoader.registerGameAsLoaded('identity-anomaly', p1)
      gameLoader.registerGameAsLoaded('identity-anomaly', p2)
      expect((await load).isOk()).toBe(true)
      await gameLoader.cancelLoadingForLobbyViolation(
        'identity-anomaly',
        77,
        1,
        p2,
        new Date(),
        penalty,
      )
      expect(penalty).not.toHaveBeenCalled()
    })
  })

  describe('failed setup settlement', () => {
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())

    test('client failure waits for final setup evidence before blaming that player', async () => {
      const { load } = await startNetworkedLoad('client-failed')
      netcodeV2Service.fetchSessionLoadState
        .mockResolvedValueOnce({
          known: true,
          setupFinal: false,
          connectedSlots: [0],
          startedSlots: [],
        })
        .mockResolvedValue({ known: true, setupFinal: true, connectedSlots: [0], startedSlots: [] })
      expect(gameLoader.maybeCancelLoading('client-failed', p1)).toBe(true)
      await vi.advanceTimersByTimeAsync(1)
      expect(wasCancelPublished()).toBe(false)
      expect(netcodeV2Service.fetchSessionLoadState).toHaveBeenCalledWith(
        77,
        expect.objectContaining({ settleLobby: true }),
      )
      await vi.advanceTimersByTimeAsync(ATTEST_POLL_MS)
      expect((await load).errorOrNull()?.data).toEqual({ userId: p1 })
    })

    test("a dropped site connection doesn't fail the load", async () => {
      const player1 = makePlayer(p1)
      const player2 = makePlayer(p2)
      const clients = new Map([
        [p1, makeClient(p1)],
        [p2, makeClient(p2)],
      ])
      asMockedFunction(registerGame).mockResolvedValue({
        gameId: 'subscription-disconnect',
        resultCodes: new Map([
          [p1, '1'],
          [p2, '2'],
        ]),
      } as any)
      activityRegistry.getClientForUser.mockImplementation(id => clients.get(id))
      asMockedFunction(findUsersById).mockResolvedValue([makeUser(p1), makeUser(p2)])
      const load = gameLoader.loadGame({
        players: [player1.player, player2.player],
        playerInfos: [player1.playerInfo, player2.playerInfo],
        mapId,
        gameConfig: lobbyConfig([
          [{ id: p1, race: 't', isComputer: false }],
          [{ id: p2, race: 'z', isComputer: false }],
        ]),
      })
      for (let i = 0; i < 100; i++) await Promise.resolve()

      // Nothing hears about the subscription closing, so its drop can't start failure resolution
      for (const client of clients.values()) {
        expect(client.subscribe).toHaveBeenCalled()
        expect(client.subscribe.mock.calls.every(call => call.length === 1)).toBe(true)
      }
      gameLoader.registerGameAsLoaded('subscription-disconnect', p1)
      gameLoader.registerGameAsLoaded('subscription-disconnect', p2)
      expect((await load).isOk()).toBe(true)
      expect(netcodeV2Service.fetchSessionLoadState).not.toHaveBeenCalled()
    })

    test('late evidence staging shares the existing resolution deadline', async () => {
      const { load } = await startNetworkedLoad('shared-budget', true)
      gameLoader.maybeCancelLoading('shared-budget', p1)
      await vi.advanceTimersByTimeAsync(ATTEST_BUDGET_MS - 3_000)
      const stage = vi.fn(() => new Promise<void>(() => {}))
      const evidence = gameLoader.cancelLoadingForLobbyViolation(
        'shared-budget',
        77,
        1,
        p2,
        new Date(),
        stage,
      )
      await vi.advanceTimersByTimeAsync(3_000)
      expect(await evidence).toBe(true)
      expect((await load).errorOrNull()?.code).toBe(GameLoadErrorType.Internal)
    })

    test('does not assign ordinary blame until the final decision is durable', async () => {
      const { load } = await startNetworkedLoad('final-write-hangs')
      netcodeV2Service.fetchSessionLoadState.mockResolvedValue({
        known: true,
        setupFinal: true,
        connectedSlots: [0],
        startedSlots: [],
      })
      asMockedFunction(finalizeGameSetupCancellation).mockImplementationOnce(
        () => new Promise<boolean>(() => {}),
      )
      gameLoader.maybeCancelLoading('final-write-hangs', p1)
      await vi.advanceTimersByTimeAsync(ATTEST_BUDGET_MS - 1)
      expect(wasCancelPublished()).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      expect((await load).errorOrNull()?.data).toEqual({ unloaded: [] })
    })

    test('evidence arriving during final decision persistence owns the cancellation', async () => {
      const { load } = await startNetworkedLoad('final-write-race', true)
      netcodeV2Service.fetchSessionLoadState.mockResolvedValue({
        known: true,
        setupFinal: true,
        connectedSlots: [0],
        startedSlots: [],
      })
      let finish!: (persisted: boolean) => void
      asMockedFunction(finalizeGameSetupCancellation).mockImplementationOnce(
        () =>
          new Promise<boolean>(resolve => {
            finish = resolve
          }),
      )
      gameLoader.maybeCancelLoading('final-write-race', p1)
      await vi.advanceTimersByTimeAsync(1)
      await gameLoader.cancelLoadingForLobbyViolation(
        'final-write-race',
        77,
        1,
        p2,
        new Date(),
        vi.fn().mockResolvedValue(true),
      )
      finish(false)
      await vi.advanceTimersByTimeAsync(1)
      expect((await load).errorOrNull()?.code).toBe(GameLoadErrorType.GameAnomaly)
      expect((await load).errorOrNull()?.data).toEqual({ userId: p2 })
    })

    test('a server cancellation stops a handed-off load without blaming a participant', async () => {
      const { load } = await startNetworkedLoad('server-cancellation')
      expect(gameLoader.cancelLoadingWithoutBlame('server-cancellation')).toBe(true)
      expect(gameLoader.registerGameAsLoaded('server-cancellation', p1)).toBe(false)
      expect((await load).errorOrNull()?.code).toBe(GameLoadErrorType.Canceled)
      expect(wasCancelPublished()).toBe(true)
    })

    test('a server cancellation cannot stop a completed load', async () => {
      const { load } = await startNetworkedLoad('completed-cancellation')
      gameLoader.registerGameAsLoaded('completed-cancellation', p1)
      gameLoader.registerGameAsLoaded('completed-cancellation', p2)
      expect((await load).isOk()).toBe(true)
      expect(gameLoader.cancelLoadingWithoutBlame('completed-cancellation')).toBe(false)
      expect(wasCancelPublished()).toBe(false)
    })

    test('old coordinator responses cannot authorize a failure penalty', async () => {
      const { load } = await startNetworkedLoad('old-coordinator')
      netcodeV2Service.fetchSessionLoadState.mockResolvedValue({
        known: true,
        connectedSlots: [0],
        startedSlots: [],
      })
      gameLoader.maybeCancelLoading('old-coordinator', p1)
      await vi.advanceTimersByTimeAsync(ATTEST_BUDGET_MS)
      expect((await load).errorOrNull()?.data).toEqual({ unloaded: [] })
    })

    test('a snapshot violation overrides an innocent player failure without waiting for its webhook', async () => {
      const stage = vi.fn().mockResolvedValue(undefined)
      container.registerInstance(LOBBY_VIOLATION_STAGER, { stage })
      const { load } = await startNetworkedLoad('snapshot-evidence', true)
      netcodeV2Service.fetchSessionLoadState.mockResolvedValue({
        known: false,
        setupFinal: false,
        lobbyViolationSlots: [1],
        connectedSlots: [0, 1],
        startedSlots: [],
      })
      gameLoader.maybeCancelLoading('snapshot-evidence', p1)
      await vi.advanceTimersByTimeAsync(1)
      const error = (await load).errorOrNull()
      expect(error?.code).toBe(GameLoadErrorType.GameAnomaly)
      expect(error?.data).toEqual({ userId: p2 })
      expect(stage).toHaveBeenCalledWith('snapshot-evidence', p2, expect.any(Date))
      container.clearInstances()
    })
  })

  describe('load deadline attribution', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })
    afterEach(() => {
      vi.useRealTimers()
    })

    /**
     * A coordinator that has held the session since creation, whose every serving relay attests
     * afresh on each pull, and that saw nothing beyond what the webhooks already delivered.
     */
    function coordinatorConfirmsComplete() {
      netcodeV2Service.fetchSessionLoadState.mockResolvedValue({
        known: true,
        setupFinal: true,
        connectedSlots: [],
        startedSlots: [],
      })
    }

    test('blames only the player who never reached the relay', async () => {
      coordinatorConfirmsComplete()
      const { load } = await startNetworkedLoad('game-one-missing')
      gameLoader.recordPlayerConnected('game-one-missing', p1)

      const error = await expectTimeout(load)

      expect(error.data.unloaded).toEqual([p2])
    })

    test('blames only the player whose game loop never started once the session started', async () => {
      coordinatorConfirmsComplete()
      const { load } = await startNetworkedLoad('game-one-unstarted')
      gameLoader.recordPlayerConnected('game-one-unstarted', p1)
      gameLoader.recordPlayerConnected('game-one-unstarted', p2)
      gameLoader.recordSessionStarted('game-one-unstarted')
      gameLoader.registerGameAsLoaded('game-one-unstarted', p1)

      const error = await expectTimeout(load)

      expect(error.data.unloaded).toEqual([p2])
    })

    test('blames nobody when no player ever reached the relay', async () => {
      const { load } = await startNetworkedLoad('game-none-connected')

      const error = await expectTimeout(load)

      expect(error.data.unloaded).toEqual([])
    })

    test('blames nobody when everyone connected and the session started but no game loop did', async () => {
      const { load } = await startNetworkedLoad('game-none-started')
      gameLoader.recordPlayerConnected('game-none-started', p1)
      gameLoader.recordPlayerConnected('game-none-started', p2)
      gameLoader.recordSessionStarted('game-none-started')

      const error = await expectTimeout(load)

      expect(error.data.unloaded).toEqual([])
    })

    test('blames the player the coordinator pull shows never connected, with no webhooks at all', async () => {
      netcodeV2Service.fetchSessionLoadState.mockResolvedValue({
        known: true,
        setupFinal: true,
        connectedSlots: [0],
        startedSlots: [],
      })
      const { load } = await startNetworkedLoad('game-pull-connected')

      const error = await expectTimeout(load)

      // Slot 0 is p1, so only p2 is unaccounted for even though no webhook ever arrived.
      expect(netcodeV2Service.fetchSessionLoadState).toHaveBeenCalledWith(
        77,
        expect.objectContaining({ timeoutMs: expect.any(Number) }),
      )
      expect(error.data.unloaded).toEqual([p2])
    })

    test("blames nobody when a reported start isn't backed by any forwarded turn", async () => {
      netcodeV2Service.fetchSessionLoadState.mockResolvedValue({
        known: true,
        setupFinal: true,
        startedAtMs: 1700000000000,
        connectedSlots: [0, 1],
        startedSlots: [0],
        forwardedSlots: [],
        turnsKnown: true,
      })
      const { load } = await startNetworkedLoad('game-start-unforwarded')

      const error = await expectTimeout(load)

      expect(error.data.unloaded).toEqual([])
    })

    test('a start reported over the webhook still needs forwarded turns to blame anyone', async () => {
      netcodeV2Service.fetchSessionLoadState.mockResolvedValue({
        known: true,
        setupFinal: true,
        startedAtMs: 1700000000000,
        connectedSlots: [0, 1],
        startedSlots: [],
        forwardedSlots: [],
        turnsKnown: true,
      })
      const { load } = await startNetworkedLoad('game-webhook-start-unforwarded')
      gameLoader.registerGameAsLoaded('game-webhook-start-unforwarded', p1)

      const error = await expectTimeout(load)

      expect(error.data.unloaded).toEqual([])
    })

    test('blames the player who never loaded once a reported start is backed by forwarded turns', async () => {
      netcodeV2Service.fetchSessionLoadState.mockResolvedValue({
        known: true,
        setupFinal: true,
        startedAtMs: 1700000000000,
        connectedSlots: [0, 1],
        startedSlots: [0],
        forwardedSlots: [0],
        turnsKnown: true,
      })
      const { load } = await startNetworkedLoad('game-start-forwarded')

      const error = await expectTimeout(load)

      expect(error.data.unloaded).toEqual([p2])
    })

    test("doesn't blame a player whose turns were forwarded though its start report never came", async () => {
      netcodeV2Service.fetchSessionLoadState.mockResolvedValue({
        known: true,
        setupFinal: true,
        startedAtMs: 1700000000000,
        connectedSlots: [0, 1],
        startedSlots: [0],
        forwardedSlots: [0, 1],
        turnsKnown: true,
      })
      const { load } = await startNetworkedLoad('game-forwarded-unreported')

      const error = await expectTimeout(load)

      expect(error.data.unloaded).toEqual([])
    })

    test('keeps turns forwarded on an earlier pull the coordinator could not vouch for', async () => {
      netcodeV2Service.fetchSessionLoadState
        .mockResolvedValueOnce({
          known: false,
          startedAtMs: 1700000000000,
          connectedSlots: [0, 1],
          startedSlots: [0],
          forwardedSlots: [0],
          turnsKnown: false,
        })
        .mockResolvedValue({
          known: true,
          setupFinal: true,
          startedAtMs: 1700000000000,
          connectedSlots: [0, 1],
          startedSlots: [0],
          forwardedSlots: [],
          turnsKnown: true,
        })
      const { load } = await startNetworkedLoad('game-forwarded-earlier')

      const error = await expectTimeout(load)

      expect(error.data.unloaded).toEqual([p2])
    })

    test('blames on reported starts alone when the coordinator cannot vouch for forwarded turns', async () => {
      netcodeV2Service.fetchSessionLoadState.mockResolvedValue({
        known: true,
        setupFinal: true,
        startedAtMs: 1700000000000,
        connectedSlots: [0, 1],
        startedSlots: [0],
        forwardedSlots: [],
        turnsKnown: false,
      })
      const { load } = await startNetworkedLoad('game-start-turns-unknown')

      const error = await expectTimeout(load)

      expect(error.data.unloaded).toEqual([p2])
    })

    test("turn evidence doesn't change blame for a player who never connected", async () => {
      netcodeV2Service.fetchSessionLoadState.mockResolvedValue({
        known: true,
        setupFinal: true,
        connectedSlots: [0],
        startedSlots: [],
        forwardedSlots: [],
        turnsKnown: true,
      })
      const { load } = await startNetworkedLoad('game-unconnected-with-turn-evidence')

      const error = await expectTimeout(load)

      expect(error.data.unloaded).toEqual([p2])
    })

    test('completes the load when the coordinator pull shows every game loop running', async () => {
      netcodeV2Service.fetchSessionLoadState.mockResolvedValue({
        known: true,
        setupFinal: true,
        startedAtMs: 1700000000000,
        connectedSlots: [0, 1],
        startedSlots: [0, 1],
      })
      const { load } = await startNetworkedLoad('game-pull-started')

      await vi.advanceTimersByTimeAsync(LOAD_DEADLINE_MS + 5_000)
      const result = await load

      expect(result.isOk()).toBe(true)
      expect(wasCancelPublished()).toBe(false)
    })

    test('blames nobody when the coordinator pull keeps failing, whatever the webhooks said', async () => {
      netcodeV2Service.fetchSessionLoadState.mockRejectedValue(new Error('coordinator down'))
      const { load } = await startNetworkedLoad('game-pull-failed')
      gameLoader.recordPlayerConnected('game-pull-failed', p1)

      const error = await expectTimeout(load)

      // p2's absence could just as well be a dropped notification, so it can't be held against them.
      expect(error.data.unloaded).toEqual([])
    })

    test('blames nobody when the coordinator never vouches for its record', async () => {
      netcodeV2Service.fetchSessionLoadState.mockResolvedValue({
        known: false,
        connectedSlots: [],
        startedSlots: [],
      })
      const { load } = await startNetworkedLoad('game-pull-unknown')
      gameLoader.recordPlayerConnected('game-pull-unknown', p1)
      gameLoader.recordSessionStarted('game-pull-unknown')
      gameLoader.registerGameAsLoaded('game-pull-unknown', p1)

      const error = await expectTimeout(load)

      expect(error.data.unloaded).toEqual([])
    })

    test('completes once a later pull carries a start the first one had not recorded', async () => {
      netcodeV2Service.fetchSessionLoadState
        .mockResolvedValueOnce({
          // A relay didn't attest, so p2 not being in the record means nothing yet.
          known: false,
          connectedSlots: [0, 1],
          startedSlots: [0],
        })
        .mockResolvedValue({
          known: true,
          setupFinal: true,
          startedAtMs: 1700000000000,
          connectedSlots: [0, 1],
          startedSlots: [0, 1],
        })
      const { load } = await startNetworkedLoad('game-record-catches-up')

      await vi.advanceTimersByTimeAsync(LOAD_DEADLINE_MS + ATTEST_BUDGET_MS + 5_000)
      const result = await load

      expect(result.isOk()).toBe(true)
      expect(wasCancelPublished()).toBe(false)
      expect(netcodeV2Service.fetchSessionLoadState).toHaveBeenCalledTimes(2)
    })

    test('blames the player still missing once every relay has attested', async () => {
      netcodeV2Service.fetchSessionLoadState
        .mockResolvedValueOnce({
          known: false,
          connectedSlots: [0],
          startedSlots: [],
        })
        .mockResolvedValue({
          known: true,
          setupFinal: true,
          connectedSlots: [0],
          startedSlots: [],
        })
      const { load } = await startNetworkedLoad('game-record-still-missing')

      const error = await expectTimeout(load)

      expect(error.data.unloaded).toEqual([p2])
      // The second pull is what decided it, so the wait cost one poll interval and no more.
      expect(netcodeV2Service.fetchSessionLoadState).toHaveBeenCalledTimes(2)
    })

    test('blames nobody when the record is never fully attested', async () => {
      netcodeV2Service.fetchSessionLoadState.mockResolvedValue({
        // A relay the coordinator can't reach never attests, so the record is never vouched for.
        known: false,
        connectedSlots: [0],
        startedSlots: [],
      })
      const { load } = await startNetworkedLoad('game-record-never-attested')

      await vi.advanceTimersByTimeAsync(LOAD_DEADLINE_MS + ATTEST_BUDGET_MS - 3_000)

      // Still asking: p2's absence isn't evidence until every relay has vouched for the record.
      expect(wasCancelPublished()).toBe(false)

      await vi.advanceTimersByTimeAsync(5_000)
      const result = await load

      expect(result.isError()).toBe(true)
      const error = result.errorOrNull() as BaseGameLoaderError<GameLoadErrorType.Timeout>
      expect(error.code).toBe(GameLoadErrorType.Timeout)
      expect(error.data.unloaded).toEqual([])
      // Instant answers every poll interval until the budget can't fit another wait.
      expect(netcodeV2Service.fetchSessionLoadState).toHaveBeenCalledTimes(
        ATTEST_BUDGET_MS / ATTEST_POLL_MS,
      )
    })

    test('slow pulls are cut to the remaining budget, so the budget bounds the wait', async () => {
      const SLOW_PULL_MS = 6_000
      // A coordinator that takes as long as each request allows and never fully attests.
      netcodeV2Service.fetchSessionLoadState.mockImplementation(
        async (_session: number, options?: { timeoutMs?: number }) => {
          const [delay] = timeoutPromise(Math.min(SLOW_PULL_MS, options?.timeoutMs ?? SLOW_PULL_MS))
          await delay
          return { known: false, connectedSlots: [0], startedSlots: [] }
        },
      )
      const { load } = await startNetworkedLoad('game-slow-pulls')

      await vi.advanceTimersByTimeAsync(LOAD_DEADLINE_MS + ATTEST_BUDGET_MS - 1_000)
      expect(wasCancelPublished()).toBe(false)

      // The budget runs out exactly here, not three full pulls later.
      await vi.advanceTimersByTimeAsync(1_000)
      expect(wasCancelPublished()).toBe(true)
      const result = await load

      expect(result.isError()).toBe(true)
      const error = result.errorOrNull() as BaseGameLoaderError<GameLoadErrorType.Timeout>
      expect(error.data.unloaded).toEqual([])
      // Three pulls of six, six, and the remaining four seconds, two seconds apart, land exactly on
      // the budget rather than three full pulls past it.
      expect(netcodeV2Service.fetchSessionLoadState).toHaveBeenCalledTimes(3)
      expect(netcodeV2Service.fetchSessionLoadState).toHaveBeenLastCalledWith(
        77,
        expect.objectContaining({ timeoutMs: 4_000 }),
      )
    })

    /** A coordinator whose answer never comes within the pull's own timeout. */
    function pullThatHangs() {
      const signals: AbortSignal[] = []
      netcodeV2Service.fetchSessionLoadState.mockImplementation(
        async (_session: number, options?: { timeoutMs?: number; signal?: AbortSignal }) => {
          if (options?.signal) {
            signals.push(options.signal)
          }
          const [delay] = timeoutPromise(options?.timeoutMs ?? 6_000)
          await delay
          return { known: false, connectedSlots: [], startedSlots: [] }
        },
      )
      return signals
    }

    test('start reports during resolution wait for the pull before completing', async () => {
      const signals = pullThatHangs()
      const { load } = await startNetworkedLoad('game-complete-mid-pull')

      // Past the deadline, so a pull is in flight.
      await vi.advanceTimersByTimeAsync(LOAD_DEADLINE_MS + 1_000)
      expect(signals).toHaveLength(1)
      expect(signals[0].aborted).toBe(false)

      gameLoader.registerGameAsLoaded('game-complete-mid-pull', p1)
      gameLoader.registerGameAsLoaded('game-complete-mid-pull', p2)
      await vi.advanceTimersByTimeAsync(5_000)
      const result = await load

      expect(result.isOk()).toBe(true)
      // The answer has no use anymore, so the request is not left running out its timeout.
      expect(signals[0].aborted).toBe(true)
      await vi.advanceTimersByTimeAsync(ATTEST_BUDGET_MS)
      expect(netcodeV2Service.fetchSessionLoadState).toHaveBeenCalledTimes(1)
      expect(wasCancelPublished()).toBe(false)
    })

    test('a client failure during resolution shares the budget and cannot bypass evidence', async () => {
      const signals = pullThatHangs()
      const { load } = await startNetworkedLoad('game-cancel-mid-pull')

      await vi.advanceTimersByTimeAsync(LOAD_DEADLINE_MS + 1_000)
      expect(signals).toHaveLength(1)

      gameLoader.maybeCancelLoading('game-cancel-mid-pull', p1)
      expect(signals[0].aborted).toBe(false)
      await vi.advanceTimersByTimeAsync(ATTEST_BUDGET_MS)
      const result = await load

      expect(result.isError()).toBe(true)
      expect(signals[0].aborted).toBe(true)
      await vi.advanceTimersByTimeAsync(ATTEST_BUDGET_MS)
      expect(netcodeV2Service.fetchSessionLoadState).toHaveBeenCalledTimes(3)
      expect(result.errorOrNull()?.data).toEqual({ unloaded: [] })
    })

    test('completes on positive evidence the coordinator cannot vouch for', async () => {
      netcodeV2Service.fetchSessionLoadState.mockResolvedValue({
        known: false,
        startedAtMs: 1700000000000,
        connectedSlots: [0, 1],
        startedSlots: [0, 1],
      })
      const { load } = await startNetworkedLoad('game-unknown-all-started')

      await vi.advanceTimersByTimeAsync(LOAD_DEADLINE_MS + 5_000)
      const result = await load

      // What the coordinator saw happened whether or not it can promise it saw everything.
      expect(result.isOk()).toBe(true)
      expect(netcodeV2Service.fetchSessionLoadState).toHaveBeenCalledTimes(1)
    })

    test('blames nobody for a partial record the coordinator cannot vouch for', async () => {
      netcodeV2Service.fetchSessionLoadState.mockResolvedValue({
        known: false,
        connectedSlots: [0],
        startedSlots: [0],
      })
      const { load } = await startNetworkedLoad('game-unknown-partial')

      const error = await expectTimeout(load)

      expect(error.data.unloaded).toEqual([])
    })

    test('decides on the pull after a failed one, once the record is attested', async () => {
      netcodeV2Service.fetchSessionLoadState
        .mockRejectedValueOnce(new Error('coordinator down'))
        .mockResolvedValue({
          known: true,
          setupFinal: true,
          connectedSlots: [0],
          startedSlots: [],
        })
      const { load } = await startNetworkedLoad('game-pull-retried')

      const error = await expectTimeout(load)

      expect(error.data.unloaded).toEqual([p2])
      expect(netcodeV2Service.fetchSessionLoadState).toHaveBeenCalledTimes(2)
    })

    test('still completes on webhook evidence alone when every game loop is known to be running', async () => {
      netcodeV2Service.fetchSessionLoadState.mockRejectedValue(new Error('coordinator down'))
      const { load } = await startNetworkedLoad('game-webhooks-complete')
      gameLoader.registerGameAsLoaded('game-webhooks-complete', p1)
      // The second start lands the load before the deadline; the deadline path is not exercised.
      gameLoader.registerGameAsLoaded('game-webhooks-complete', p2)

      const result = await load

      expect(result.isOk()).toBe(true)
    })

    describe('players who left', () => {
      /** Six players, slots 0 through 5 in order, as in a 3v3. */
      const sixPlayers = [1, 2, 3, 4, 5, 6].map(id => ({
        userId: makeSbUserId(id),
        isObserver: false,
      }))
      const userAt = (slot: number) => sixPlayers[slot].userId

      /**
       * A pull that vouches for everyone but the players who left: every relay fenced its live
       * slots, named its closed ones, reported its forwarded turns, and settled setup. Unless a
       * test says otherwise, every connected slot that isn't closed is still live, and each closed
       * slot is closed on the one link `closedEpochs` (or a fixed per-slot default) names.
       */
      function closedPull(fields: {
        connectedSlots: number[]
        closedSlots: number[]
        closedEpochs?: Record<number, string | undefined>
        liveSlots?: number[]
        startedAtMs?: number
        startedSlots?: number[]
        forwardedSlots?: number[]
      }) {
        const { closedSlots, closedEpochs, ...rest } = fields
        return {
          known: false,
          setupFinal: true,
          turnsKnown: true,
          closedKnown: true,
          startedSlots: [],
          forwardedSlots: [],
          liveSlots: fields.connectedSlots.filter(slot => !closedSlots.includes(slot)),
          ...rest,
          closedSlots: closedSlots.map(slot => ({
            slot,
            epoch: closedEpochs && slot in closedEpochs ? closedEpochs[slot] : `${1000 + slot}`,
          })),
        }
      }

      test('starts over when a player reconnected and left again between pulls', async () => {
        // p1 was closed on link 1, came back unseen, and left again on link 2 after p2's relay last
        // saw p2. Two pulls showing p1 closed don't make one disconnection, so p2 being live in the
        // second says nothing about p1's current one. Only a third pull, with p1 still on link 2
        // and p2 still there, does.
        const onLink = (epoch: string) =>
          closedPull({
            startedAtMs: 1700000000000,
            connectedSlots: [0, 1],
            closedSlots: [0],
            closedEpochs: { 0: epoch },
          })
        netcodeV2Service.fetchSessionLoadState
          .mockResolvedValueOnce(onLink('1'))
          .mockResolvedValueOnce(onLink('2'))
          .mockResolvedValue(onLink('2'))
        const { load } = await startNetworkedLoad('game-hidden-reconnect')

        const error = await expectTimeout(load)

        expect(error.data.unloaded).toEqual([p1])
        expect(netcodeV2Service.fetchSessionLoadState).toHaveBeenCalledTimes(3)
      })

      test('blames nobody when the second link appears only in the last pull the budget allows', async () => {
        const pulls = ATTEST_BUDGET_MS / ATTEST_POLL_MS
        const onLink = (epoch: string) =>
          closedPull({
            startedAtMs: 1700000000000,
            connectedSlots: [0, 1],
            closedSlots: [0],
            closedEpochs: { 0: epoch },
          })
        for (let i = 0; i < pulls - 1; i++) {
          netcodeV2Service.fetchSessionLoadState.mockResolvedValueOnce({
            ...onLink('1'),
            setupFinal: false,
          })
        }
        netcodeV2Service.fetchSessionLoadState.mockResolvedValue(onLink('2'))
        const { load } = await startNetworkedLoad('game-hidden-reconnect-late')

        const error = await expectTimeout(load)

        expect(error.data.unloaded).toEqual([])
        expect(netcodeV2Service.fetchSessionLoadState).toHaveBeenCalledTimes(pulls)
      })

      test('never blames a player closed on a link the relay recorded no epoch for', async () => {
        netcodeV2Service.fetchSessionLoadState.mockResolvedValue(
          closedPull({
            startedAtMs: 1700000000000,
            connectedSlots: [0, 1],
            closedSlots: [0],
            closedEpochs: { 0: undefined },
          }),
        )
        const { load } = await startNetworkedLoad('game-closed-without-epoch')

        const error = await expectTimeout(load)

        expect(error.data.unloaded).toEqual([])
        // Nothing a later pull could show would let it be blamed, so there's no waiting for one.
        expect(netcodeV2Service.fetchSessionLoadState).toHaveBeenCalledTimes(1)
      })

      test("doesn't count a player who started and then left as having stayed", async () => {
        // Both players of a 1v1 are gone. p1 had reported starting, so it isn't closed, but it
        // isn't live either: nobody stayed, so p2 leaving looks like the network, not a choice.
        netcodeV2Service.fetchSessionLoadState.mockResolvedValue(
          closedPull({
            startedAtMs: 1700000000000,
            connectedSlots: [0, 1],
            startedSlots: [0],
            forwardedSlots: [0],
            closedSlots: [1],
            liveSlots: [],
          }),
        )
        const { load } = await startNetworkedLoad('game-started-then-left')

        const error = await expectTimeout(load)

        expect(error.data.unloaded).toEqual([])
      })

      test('blames the quitter when everyone else started and is still there', async () => {
        netcodeV2Service.fetchSessionLoadState.mockResolvedValue(
          closedPull({
            startedAtMs: 1700000000000,
            connectedSlots: [0, 1, 2, 3, 4, 5],
            startedSlots: [1, 2, 3, 4, 5],
            forwardedSlots: [1, 2, 3, 4, 5],
            closedSlots: [0],
          }),
        )
        const { load } = await startRosterLoad('game-quit-while-others-started', sixPlayers)

        const error = await expectTimeout(load)

        expect(error.data.unloaded).toEqual([userAt(0)])
      })

      test('blames the one player who closed their game after the session started', async () => {
        netcodeV2Service.fetchSessionLoadState.mockResolvedValue(
          closedPull({
            startedAtMs: 1700000000000,
            connectedSlots: [0, 1, 2, 3, 4, 5],
            closedSlots: [0],
          }),
        )
        const { load } = await startRosterLoad('game-one-quitter', sixPlayers)

        const error = await expectTimeout(load)

        expect(error.data.unloaded).toEqual([userAt(0)])
        // The first pull saw the leaver; the second showed the others still there after they left.
        expect(netcodeV2Service.fetchSessionLoadState).toHaveBeenCalledTimes(2)
      })

      test('blames a leaver only once a later pull shows someone stayed after them', async () => {
        // Each relay snapshots at its own moment, so one pull can show p2 live although p2 was gone
        // before p1 left. Only a later pull orders p2 being there after p1 had gone.
        const leftBeside = closedPull({
          startedAtMs: 1700000000000,
          connectedSlots: [0, 1],
          closedSlots: [0],
        })
        netcodeV2Service.fetchSessionLoadState
          .mockResolvedValueOnce(leftBeside)
          .mockResolvedValue(leftBeside)
        const { load } = await startNetworkedLoad('game-leaver-witnessed')

        const error = await expectTimeout(load)

        expect(error.data.unloaded).toEqual([p1])
        expect(netcodeV2Service.fetchSessionLoadState).toHaveBeenCalledTimes(2)
      })

      test('blames nobody when the player who looked live turns out to have left too', async () => {
        netcodeV2Service.fetchSessionLoadState
          .mockResolvedValueOnce(
            closedPull({ startedAtMs: 1700000000000, connectedSlots: [0, 1], closedSlots: [0] }),
          )
          .mockResolvedValue(
            closedPull({ startedAtMs: 1700000000000, connectedSlots: [0, 1], closedSlots: [0, 1] }),
          )
        const { load } = await startNetworkedLoad('game-leaver-unwitnessed')

        const error = await expectTimeout(load)

        expect(error.data.unloaded).toEqual([])
        expect(netcodeV2Service.fetchSessionLoadState).toHaveBeenCalledTimes(2)
      })

      test('blames nobody for a leaver first seen in the last pull the budget allows', async () => {
        const unvouched = {
          ...closedPull({
            startedAtMs: 1700000000000,
            connectedSlots: [0, 1, 2, 3, 4, 5],
            closedSlots: [],
          }),
          setupFinal: false,
          closedKnown: false,
        }
        const pulls = ATTEST_BUDGET_MS / ATTEST_POLL_MS
        for (let i = 0; i < pulls - 1; i++) {
          netcodeV2Service.fetchSessionLoadState.mockResolvedValueOnce(unvouched)
        }
        netcodeV2Service.fetchSessionLoadState.mockResolvedValue(
          closedPull({
            startedAtMs: 1700000000000,
            connectedSlots: [0, 1, 2, 3, 4, 5],
            closedSlots: [0],
          }),
        )
        const { load } = await startRosterLoad('game-leaver-out-of-budget', sixPlayers)

        const error = await expectTimeout(load)

        expect(error.data.unloaded).toEqual([])
        expect(netcodeV2Service.fetchSessionLoadState).toHaveBeenCalledTimes(pulls)
      })

      test('blames every closed player when no more than half the players left', async () => {
        netcodeV2Service.fetchSessionLoadState.mockResolvedValue(
          closedPull({
            startedAtMs: 1700000000000,
            connectedSlots: [0, 1, 2, 3, 4, 5],
            closedSlots: [1, 3, 5],
          }),
        )
        const { load } = await startRosterLoad('game-half-left', sixPlayers)

        const error = await expectTimeout(load)

        expect(error.data.unloaded).toEqual([userAt(1), userAt(3), userAt(5)])
      })

      test('blames nobody when more than half the players left at once', async () => {
        netcodeV2Service.fetchSessionLoadState.mockResolvedValue(
          closedPull({
            startedAtMs: 1700000000000,
            connectedSlots: [0, 1, 2, 3, 4, 5],
            closedSlots: [0, 1, 2, 3],
          }),
        )
        const { load } = await startRosterLoad('game-most-left', sixPlayers)

        const error = await expectTimeout(load)

        expect(error.data.unloaded).toEqual([])
      })

      test("judges closed players only on leaving, even once others' game loops run", async () => {
        // Missing game loops would otherwise name all four who left, which is the very mass
        // departure the half limit refuses to blame anyone for.
        netcodeV2Service.fetchSessionLoadState.mockResolvedValue(
          closedPull({
            startedAtMs: 1700000000000,
            connectedSlots: [0, 1, 2, 3, 4, 5],
            closedSlots: [0, 1, 2, 3],
            startedSlots: [4, 5],
            forwardedSlots: [4, 5],
          }),
        )
        const { load } = await startRosterLoad('game-most-left-after-starts', sixPlayers)

        const error = await expectTimeout(load)

        expect(error.data.unloaded).toEqual([])
      })

      test('blames nobody when both players of a 1v1 left', async () => {
        netcodeV2Service.fetchSessionLoadState.mockResolvedValue(
          closedPull({ startedAtMs: 1700000000000, connectedSlots: [0, 1], closedSlots: [0, 1] }),
        )
        const { load } = await startNetworkedLoad('game-everyone-left')

        const error = await expectTimeout(load)

        expect(error.data.unloaded).toEqual([])
      })

      test('blames a player who dropped before the session started, beside one who never came', async () => {
        netcodeV2Service.fetchSessionLoadState.mockResolvedValue(
          closedPull({ connectedSlots: [0, 1, 2, 3, 4], closedSlots: [2] }),
        )
        const { load } = await startRosterLoad('game-pre-start-drop', sixPlayers)

        const error = await expectTimeout(load)

        expect(error.data.unloaded).toEqual([userAt(2), userAt(5)])
      })

      test("doesn't blame a player who left and dialed back in", async () => {
        netcodeV2Service.fetchSessionLoadState
          .mockResolvedValueOnce({
            ...closedPull({
              startedAtMs: 1700000000000,
              connectedSlots: [0, 1, 2, 3, 4, 5],
              closedSlots: [0],
            }),
            // Not yet settled, so this pull can't decide anything.
            setupFinal: false,
          })
          .mockResolvedValue(
            closedPull({
              startedAtMs: 1700000000000,
              connectedSlots: [0, 1, 2, 3, 4, 5],
              closedSlots: [],
            }),
          )
        const { load } = await startRosterLoad('game-quit-and-back', sixPlayers)

        const error = await expectTimeout(load)

        expect(error.data.unloaded).toEqual([])
        expect(netcodeV2Service.fetchSessionLoadState).toHaveBeenCalledTimes(2)
      })

      test("blames nobody for leaving when the coordinator can't vouch for who left", async () => {
        // A replaced or restarted relay forgets who connected to it, so its closed set may be
        // missing players: nothing is vouched for, and the load never becomes final.
        netcodeV2Service.fetchSessionLoadState.mockResolvedValue({
          ...closedPull({
            startedAtMs: 1700000000000,
            connectedSlots: [0, 1, 2, 3, 4, 5],
            closedSlots: [0],
          }),
          setupFinal: false,
          turnsKnown: false,
          closedKnown: false,
        })
        const { load } = await startRosterLoad('game-quit-unvouched', sixPlayers)

        const error = await expectTimeout(load)

        expect(error.data.unloaded).toEqual([])
        expect(netcodeV2Service.fetchSessionLoadState).toHaveBeenCalledTimes(
          ATTEST_BUDGET_MS / ATTEST_POLL_MS,
        )
      })

      test("isn't final on a vouched closed set without vouched turn evidence", async () => {
        // A closed player's start may still be held by its client. Without forwarded turns to say
        // how far its game got, a start it reports later could leave it the only finished player.
        netcodeV2Service.fetchSessionLoadState.mockResolvedValue({
          ...closedPull({
            startedAtMs: 1700000000000,
            connectedSlots: [0, 1, 2, 3, 4, 5],
            closedSlots: [0],
          }),
          turnsKnown: false,
        })
        const { load } = await startRosterLoad('game-quit-turns-unknown', sixPlayers)

        const error = await expectTimeout(load)

        expect(error.data.unloaded).toEqual([])
        expect(netcodeV2Service.fetchSessionLoadState).toHaveBeenCalledTimes(
          ATTEST_BUDGET_MS / ATTEST_POLL_MS,
        )
      })

      test("never blames an observer for leaving, and doesn't count one as staying", async () => {
        const observer = { userId: makeSbUserId(7), isObserver: true }
        const roster = [
          { userId: p1, isObserver: false },
          { userId: p2, isObserver: false },
          observer,
        ]
        netcodeV2Service.fetchSessionLoadState.mockResolvedValue(
          closedPull({ startedAtMs: 1700000000000, connectedSlots: [0, 1, 2], closedSlots: [2] }),
        )
        const { load: observerLeft } = await startRosterLoad('game-observer-left', roster)

        expect((await expectTimeout(observerLeft)).data.unloaded).toEqual([])

        // p1 left and p2 never came, so only the observer is still there. Leaving needs another
        // player to have stayed, so p1 isn't blamed for it; p2 still is for never connecting.
        netcodeV2Service.fetchSessionLoadState.mockResolvedValue(
          closedPull({ connectedSlots: [0, 2], closedSlots: [0] }),
        )
        const { load: onlyObserverStayed } = await startRosterLoad('game-observer-stayed', roster)

        expect((await expectTimeout(onlyObserverStayed)).data.unloaded).toEqual([p2])
      })
    })

    test('a local-only load never pulls and keeps its own half-finished rule', async () => {
      const player1 = makePlayer(p1)
      registerActiveClients([player1.player])
      asMockedFunction(findUsersById).mockResolvedValue([makeUser(p1)])
      netcodeV2Service.isEnabled.mockReturnValue(false)
      asMockedFunction(registerGame).mockResolvedValue({
        gameId: 'game-local',
        resultCodes: new Map([[p1, 'code-1']]),
      } as any)

      const load = gameLoader.loadGame({
        players: [player1.player],
        playerInfos: [player1.playerInfo],
        mapId,
        gameConfig: lobbyConfig([[{ id: p1, race: 't', isComputer: false }]]),
      })
      for (let i = 0; i < 100; i++) {
        await Promise.resolve()
      }
      expect(gameLoader.isLocalOnlyLoad('game-local')).toBe(true)

      const error = await expectTimeout(load)

      // Zero finished still clears "at least half" for a lone player, so they own their own failure.
      expect(error.data.unloaded).toEqual([p1])
      expect(netcodeV2Service.fetchSessionLoadState).not.toHaveBeenCalled()
    })
  })

  test("carries a lobby's StarCraft-compatible replays setting into every player's setup", async () => {
    const { load } = await startNetworkedLoad('game-sc-compatible', false, {
      starcraftCompatibleReplays: true,
    })

    const setups = publisher.publish.mock.calls
      .filter((call: any[]) => call[1]?.type === 'setGameConfig')
      .map((call: any[]) => call[1].setup)
    expect(setups).toHaveLength(2)
    for (const setup of setups) {
      expect(setup.starcraftCompatibleReplays).toBe(true)
    }

    gameLoader.registerGameAsLoaded('game-sc-compatible', p1)
    gameLoader.registerGameAsLoaded('game-sc-compatible', p2)
    await load
  })

  test('sets up matchmaking games with StarCraft-compatible replays', async () => {
    const { load } = await startNetworkedLoad('game-mm-sc-compatible', true)

    const setups = publisher.publish.mock.calls
      .filter((call: any[]) => call[1]?.type === 'setGameConfig')
      .map((call: any[]) => call[1].setup)
    expect(setups).toHaveLength(2)
    for (const setup of setups) {
      expect(setup.starcraftCompatibleReplays).toBe(true)
    }

    gameLoader.registerGameAsLoaded('game-mm-sc-compatible', p1)
    gameLoader.registerGameAsLoaded('game-mm-sc-compatible', p2)
    await load
  })

  test('reports a networked load as not local-only', async () => {
    const { load } = await startNetworkedLoad('game-networked-flag')

    expect(gameLoader.isLocalOnlyLoad('game-networked-flag')).toBe(false)

    gameLoader.registerGameAsLoaded('game-networked-flag', p1)
    gameLoader.registerGameAsLoaded('game-networked-flag', p2)
    await load
  })

  test('accepts late load-progress reports for a finished game and rejects unknown ones', async () => {
    const { load } = await startNetworkedLoad('game-late-reports')
    gameLoader.registerGameAsLoaded('game-late-reports', p1)
    gameLoader.registerGameAsLoaded('game-late-reports', p2)
    expect((await load).isOk()).toBe(true)

    // A webhook the coordinator retried past the load's completion must read as success, not as an
    // unknown game â€” there's simply nothing left to record.
    expect(gameLoader.recordPlayerConnected('game-late-reports', p1)).toBe(true)
    expect(gameLoader.recordSessionStarted('game-late-reports')).toBe(true)
    expect(gameLoader.registerGameAsLoaded('game-late-reports', p1)).toBe(true)

    expect(gameLoader.recordPlayerConnected('game-never-existed', p1)).toBe(false)
    expect(gameLoader.recordSessionStarted('game-never-existed')).toBe(false)
    expect(gameLoader.registerGameAsLoaded('game-never-existed', p1)).toBe(false)
  })

  test('fails immediately when a multi-human game loads and netcode v2 is not enabled', async () => {
    const player1 = makePlayer(p1)
    const player2 = makePlayer(p2)
    registerActiveClients([player1.player, player2.player])
    asMockedFunction(findUsersById).mockResolvedValue([makeUser(p1), makeUser(p2)])
    netcodeV2Service.isEnabled.mockReturnValue(false)

    asMockedFunction(registerGame).mockResolvedValue({
      gameId: 'game-1',
      resultCodes: new Map([
        [p1, 'code-1'],
        [p2, 'code-2'],
      ]),
    } as any)

    const request: GameLoadRequest = {
      players: [player1.player, player2.player],
      playerInfos: [player1.playerInfo, player2.playerInfo],
      mapId,
      gameConfig: lobbyConfig([
        [{ id: p1, race: 't', isComputer: false }],
        [{ id: p2, race: 'z', isComputer: false }],
      ]),
    }

    const result = await gameLoader.loadGame(request)

    expect(result.isError()).toBe(true)
    const error = result.errorOrNull()
    expect(error).toBeInstanceOf(BaseGameLoaderError)
    expect(error?.code).toBe(GameLoadErrorType.Internal)
    expect(error?.message).toMatch(/netcode v2 is not configured/i)

    // The load should have failed before ever persisting the netcode v2 flag or creating a
    // session for it.
    expect(updateGameConfig).not.toHaveBeenCalled()
    expect(netcodeV2Service.createSessionForGame).not.toHaveBeenCalled()

    // Cancellation should have been broadcast to both players.
    expect(publisher.publish).toHaveBeenCalledWith(
      expect.stringContaining('game-1'),
      expect.objectContaining({ type: 'cancelLoading', gameId: 'game-1' }),
    )
  })

  test('loads a solo game without requiring netcode v2 to be enabled', async () => {
    const player1 = makePlayer(p1)
    registerActiveClients([player1.player])
    asMockedFunction(findUsersById).mockResolvedValue([makeUser(p1)])
    netcodeV2Service.isEnabled.mockReturnValue(false)

    asMockedFunction(registerGame).mockResolvedValue({
      gameId: 'game-solo',
      resultCodes: new Map([[p1, 'code-1']]),
    } as any)

    const request: GameLoadRequest = {
      players: [player1.player],
      playerInfos: [player1.playerInfo],
      mapId,
      gameConfig: lobbyConfig([[{ id: p1, race: 't', isComputer: false }]]),
    }

    const resultPromise = gameLoader.loadGame(request)

    // `loadGame` only resolves once every player has reported in as loaded (via
    // `registerGameAsLoaded`), so wait for the setup/publish work to finish first, then simulate
    // that report to let the load complete.
    await vi.waitFor(() => {
      expect(publisher.publish).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ type: 'setGameConfig' }),
      )
    })
    gameLoader.registerGameAsLoaded('game-solo', p1)

    const result = await resultPromise

    expect(result.isOk()).toBe(true)
    expect(updateGameConfig).toHaveBeenCalledWith(
      'game-solo',
      expect.objectContaining({ useNetcodeV2: false }),
    )
    expect(netcodeV2Service.createSessionForGame).not.toHaveBeenCalled()

    const setupPublish = publisher.publish.mock.calls.find(
      (call: any[]) => call[1].type === 'setGameConfig',
    )
    expect(setupPublish?.[1].setup).toMatchObject({ turnRate: 24, userLatency: BwUserLatency.Low })
  })

  test('loads a multi-human game and persists useNetcodeV2 when netcode v2 is enabled', async () => {
    const player1 = makePlayer(p1)
    const player2 = makePlayer(p2)
    registerActiveClients([player1.player, player2.player])
    asMockedFunction(findUsersById).mockResolvedValue([makeUser(p1), makeUser(p2)])
    netcodeV2Service.isEnabled.mockReturnValue(true)
    netcodeV2Service.createSessionForGame.mockResolvedValue({
      session: 1,
      setups: new Map([
        [p1, {} as any],
        [p2, {} as any],
      ]),
    })

    asMockedFunction(registerGame).mockResolvedValue({
      gameId: 'game-multi',
      resultCodes: new Map([
        [p1, 'code-1'],
        [p2, 'code-2'],
      ]),
    } as any)

    const request: GameLoadRequest = {
      players: [player1.player, player2.player],
      playerInfos: [player1.playerInfo, player2.playerInfo],
      mapId,
      gameConfig: lobbyConfig([
        [{ id: p1, race: 't', isComputer: false }],
        [{ id: p2, race: 'z', isComputer: false }],
      ]),
    }

    const resultPromise = gameLoader.loadGame(request)

    await vi.waitFor(() => {
      expect(publisher.publish).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ type: 'setNetcodeV2Setup' }),
      )
    })
    gameLoader.registerGameAsLoaded('game-multi', p1)
    gameLoader.registerGameAsLoaded('game-multi', p2)

    const result = await resultPromise

    expect(result.isOk()).toBe(true)
    expect(updateGameConfig).toHaveBeenCalledWith(
      'game-multi',
      expect.objectContaining({ useNetcodeV2: true }),
    )
    expect(netcodeV2Service.createSessionForGame).toHaveBeenCalledTimes(1)
    const publishedSetup = publisher.publish.mock.calls.find(
      call => call[1]?.type === 'setGameConfig',
    )![1].setup
    expect(updateGameConfig).toHaveBeenCalledWith(
      'game-multi',
      expect.objectContaining({ seed: publishedSetup.seed }),
    )
    expect(netcodeV2Service.createSessionForGame.mock.calls[0][0]).toMatchObject({
      seed: publishedSetup.seed,
    })

    expect(activityStatusService.setInGame).toHaveBeenCalledTimes(2)
    expect(activityStatusService.setInGame).toHaveBeenCalledWith(
      p1,
      'game-multi',
      expect.objectContaining({ userId: p1 }),
    )
    expect(activityStatusService.setInGame).toHaveBeenCalledWith(
      p2,
      'game-multi',
      expect.objectContaining({ userId: p2 }),
    )
  })

  test.each([1792488607, 0x80000005])(
    'persists seed %i before distributing it to every player and the relay',
    async seed => {
      const now = vi.spyOn(Date, 'now').mockReturnValue(seed * 1000)
      let finishConfigWrite!: () => void
      asMockedFunction(updateGameConfig).mockReturnValue(
        new Promise<void>(resolve => {
          finishConfigWrite = resolve
        }),
      )

      try {
        const { load } = await startNetworkedLoad('game-persisted-seed')

        expect(updateGameConfig).toHaveBeenCalledExactlyOnceWith(
          'game-persisted-seed',
          expect.objectContaining({ seed, useNetcodeV2: true }),
        )
        expect(publisher.publish.mock.calls.some(call => call[1]?.type === 'setGameConfig')).toBe(
          false,
        )
        expect(netcodeV2Service.createSessionForGame).not.toHaveBeenCalled()

        now.mockReturnValue((seed + 5) * 1000)
        finishConfigWrite()
        await vi.waitFor(() => expect(netcodeV2Service.createSessionForGame).toHaveBeenCalled())

        const setups = publisher.publish.mock.calls
          .filter(call => call[1]?.type === 'setGameConfig')
          .map(call => call[1].setup)
        expect(setups).toHaveLength(2)
        for (const setup of setups) {
          expect(setup.seed).toBe(seed)
        }
        expect(netcodeV2Service.createSessionForGame.mock.calls[0][0]).toMatchObject({
          seed,
        })

        gameLoader.registerGameAsLoaded('game-persisted-seed', p1)
        gameLoader.registerGameAsLoaded('game-persisted-seed', p2)
        expect((await load).isOk()).toBe(true)
      } finally {
        now.mockRestore()
      }
    },
  )

  test('fails the load without distributing setup when persisting game config fails', async () => {
    asMockedFunction(updateGameConfig).mockRejectedValue(new Error('database unavailable'))

    const { load } = await startNetworkedLoad('game-config-write-failed')
    const result = await load

    expect(result.errorOrNull()).toMatchObject({
      code: GameLoadErrorType.Internal,
      message: 'error persisting game config',
    })
    expect(publisher.publish.mock.calls.some(call => call[1]?.type === 'setGameConfig')).toBe(false)
    expect(netcodeV2Service.createSessionForGame).not.toHaveBeenCalled()
    expect(wasCancelPublished()).toBe(true)
  })

  test('threads each player selected region through to createSessionForGame', async () => {
    const region = makeGameServerRegionId('us-east')
    const player1 = makePlayer(p1)
    const player2 = makePlayer(p2)
    // p1 joined with a region; p2 has none and must be sent region-less.
    const player1WithRegion: GameLoadPlayer = { ...player1.player, region }
    registerActiveClients([player1WithRegion, player2.player])
    asMockedFunction(findUsersById).mockResolvedValue([makeUser(p1), makeUser(p2)])
    netcodeV2Service.isEnabled.mockReturnValue(true)
    netcodeV2Service.createSessionForGame.mockResolvedValue({
      session: 1,
      setups: new Map([
        [p1, {} as any],
        [p2, {} as any],
      ]),
    })

    asMockedFunction(registerGame).mockResolvedValue({
      gameId: 'game-region',
      resultCodes: new Map([
        [p1, 'code-1'],
        [p2, 'code-2'],
      ]),
    } as any)

    const request: GameLoadRequest = {
      players: [player1WithRegion, player2.player],
      playerInfos: [player1.playerInfo, player2.playerInfo],
      mapId,
      gameConfig: lobbyConfig([
        [{ id: p1, race: 't', isComputer: false }],
        [{ id: p2, race: 'z', isComputer: false }],
      ]),
    }

    const resultPromise = gameLoader.loadGame(request)

    await vi.waitFor(() => {
      expect(netcodeV2Service.createSessionForGame).toHaveBeenCalledTimes(1)
    })
    gameLoader.registerGameAsLoaded('game-region', p1)
    gameLoader.registerGameAsLoaded('game-region', p2)
    await resultPromise

    const { slots } = netcodeV2Service.createSessionForGame.mock.calls[0][0]
    expect(slots).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ userId: p1, region }),
        expect.objectContaining({ userId: p2, region: undefined }),
      ]),
    )
  })

  test.each([
    { gameType: GameType.UseMapSettings, isEud: true, canRollBack: false },
    { gameType: GameType.UseMapSettings, isEud: false, canRollBack: true },
    { gameType: GameType.Melee, isEud: true, canRollBack: true },
  ])(
    'passes canRollBack $canRollBack for a $gameType game on a map with isEud $isEud',
    async ({ gameType, isEud, canRollBack }) => {
      const player1 = makePlayer(p1)
      const player2 = makePlayer(p2)
      registerActiveClients([player1.player, player2.player])
      asMockedFunction(findUsersById).mockResolvedValue([makeUser(p1), makeUser(p2)])
      asMockedFunction(getMapInfos).mockResolvedValue([
        { ...makeMapInfo(), mapData: { isEud } as any },
      ])
      netcodeV2Service.isEnabled.mockReturnValue(true)
      netcodeV2Service.createSessionForGame.mockResolvedValue({
        session: 1,
        setups: new Map([
          [p1, {} as any],
          [p2, {} as any],
        ]),
      })

      asMockedFunction(registerGame).mockResolvedValue({
        gameId: 'game-eud',
        resultCodes: new Map([
          [p1, 'code-1'],
          [p2, 'code-2'],
        ]),
      } as any)

      const request: GameLoadRequest = {
        players: [player1.player, player2.player],
        playerInfos: [player1.playerInfo, player2.playerInfo],
        mapId,
        gameConfig: {
          ...lobbyConfig([
            [{ id: p1, race: 't', isComputer: false }],
            [{ id: p2, race: 'z', isComputer: false }],
          ]),
          gameType,
        },
      }

      const resultPromise = gameLoader.loadGame(request)

      await vi.waitFor(() => {
        expect(netcodeV2Service.createSessionForGame).toHaveBeenCalledTimes(1)
      })
      gameLoader.registerGameAsLoaded('game-eud', p1)
      gameLoader.registerGameAsLoaded('game-eud', p2)
      await resultPromise

      expect(netcodeV2Service.createSessionForGame.mock.calls[0][0].canRollBack).toBe(canRollBack)
    },
  )

  test('threads each player measured rtt through to createSessionForGame', async () => {
    const player1 = makePlayer(p1)
    const player2 = makePlayer(p2)
    registerActiveClients([player1.player, player2.player])
    asMockedFunction(findUsersById).mockResolvedValue([makeUser(p1), makeUser(p2)])
    netcodeV2Service.isEnabled.mockReturnValue(true)
    netcodeV2Service.createSessionForGame.mockResolvedValue({
      session: 1,
      setups: new Map([
        [p1, {} as any],
        [p2, {} as any],
      ]),
    })

    asMockedFunction(registerGame).mockResolvedValue({
      gameId: 'game-rtt',
      resultCodes: new Map([
        [p1, 'code-1'],
        [p2, 'code-2'],
      ]),
    } as any)

    const request: GameLoadRequest = {
      // p1 has a recorded rtt; p2 has none and must be sent without one.
      players: [{ ...player1.player, rttMs: 42 }, player2.player],
      playerInfos: [player1.playerInfo, player2.playerInfo],
      mapId,
      gameConfig: lobbyConfig([
        [{ id: p1, race: 't', isComputer: false }],
        [{ id: p2, race: 'z', isComputer: false }],
      ]),
    }

    const resultPromise = gameLoader.loadGame(request)

    await vi.waitFor(() => {
      expect(netcodeV2Service.createSessionForGame).toHaveBeenCalledTimes(1)
    })
    gameLoader.registerGameAsLoaded('game-rtt', p1)
    gameLoader.registerGameAsLoaded('game-rtt', p2)
    await resultPromise

    const { slots } = netcodeV2Service.createSessionForGame.mock.calls[0][0]
    expect(slots).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ userId: p1, rttMs: 42 }),
        expect.objectContaining({ userId: p2, rttMs: undefined }),
      ]),
    )
  })

  test('threads each player netcode v2 pubkey through to createSessionForGame', async () => {
    const player1 = makePlayer(p1)
    const player2 = makePlayer(p2)
    registerActiveClients([player1.player, player2.player])
    asMockedFunction(findUsersById).mockResolvedValue([makeUser(p1), makeUser(p2)])
    netcodeV2Service.isEnabled.mockReturnValue(true)
    netcodeV2Service.createSessionForGame.mockResolvedValue({
      session: 1,
      setups: new Map([
        [p1, {} as any],
        [p2, {} as any],
      ]),
    })

    asMockedFunction(registerGame).mockResolvedValue({
      gameId: 'game-pubkey',
      resultCodes: new Map([
        [p1, 'code-1'],
        [p2, 'code-2'],
      ]),
    } as any)

    const pubkey1 = Buffer.alloc(32, 1).toString('base64')
    const pubkey2 = Buffer.alloc(32, 2).toString('base64')
    const request: GameLoadRequest = {
      players: [
        { ...player1.player, netcodeV2Pubkey: pubkey1 },
        { ...player2.player, netcodeV2Pubkey: pubkey2 },
      ],
      playerInfos: [player1.playerInfo, player2.playerInfo],
      mapId,
      gameConfig: lobbyConfig([
        [{ id: p1, race: 't', isComputer: false }],
        [{ id: p2, race: 'z', isComputer: false }],
      ]),
    }

    const resultPromise = gameLoader.loadGame(request)

    await vi.waitFor(() => {
      expect(netcodeV2Service.createSessionForGame).toHaveBeenCalledTimes(1)
    })
    gameLoader.registerGameAsLoaded('game-pubkey', p1)
    gameLoader.registerGameAsLoaded('game-pubkey', p2)
    await resultPromise

    const { slots } = netcodeV2Service.createSessionForGame.mock.calls[0][0]
    expect(slots).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ userId: p1, pubkey: pubkey1 }),
        expect.objectContaining({ userId: p2, pubkey: pubkey2 }),
      ]),
    )
  })

  test('publishes a provisioning status to every player when the coordinator reports provisioning', async () => {
    const player1 = makePlayer(p1)
    const player2 = makePlayer(p2)
    registerActiveClients([player1.player, player2.player])
    asMockedFunction(findUsersById).mockResolvedValue([makeUser(p1), makeUser(p2)])
    netcodeV2Service.isEnabled.mockReturnValue(true)
    netcodeV2Service.createSessionForGame.mockImplementation(async ({ onProvisioning }) => {
      onProvisioning?.(['us-east', 'eu-west'])
      return {
        session: 1,
        setups: new Map([
          [p1, {} as any],
          [p2, {} as any],
        ]),
      }
    })

    asMockedFunction(registerGame).mockResolvedValue({
      gameId: 'game-prov',
      resultCodes: new Map([
        [p1, 'code-1'],
        [p2, 'code-2'],
      ]),
    } as any)

    const request: GameLoadRequest = {
      players: [player1.player, player2.player],
      playerInfos: [player1.playerInfo, player2.playerInfo],
      mapId,
      gameConfig: lobbyConfig([
        [{ id: p1, race: 't', isComputer: false }],
        [{ id: p2, race: 'z', isComputer: false }],
      ]),
    }

    const resultPromise = gameLoader.loadGame(request)

    await vi.waitFor(() => {
      expect(publisher.publish).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          type: 'setLoadingStatus',
          gameId: 'game-prov',
          status: 'provisioningGameServer',
        }),
      )
    })
    gameLoader.registerGameAsLoaded('game-prov', p1)
    gameLoader.registerGameAsLoaded('game-prov', p2)
    await resultPromise
  })

  test('extends the load deadline on provisioning so the load survives past the base timeout', async () => {
    vi.useFakeTimers()
    try {
      const player1 = makePlayer(p1)
      const player2 = makePlayer(p2)
      registerActiveClients([player1.player, player2.player])
      asMockedFunction(findUsersById).mockResolvedValue([makeUser(p1), makeUser(p2)])
      netcodeV2Service.isEnabled.mockReturnValue(true)
      netcodeV2Service.createSessionForGame.mockImplementation(async ({ onProvisioning }) => {
        onProvisioning?.(['us-east'])
        return {
          session: 1,
          setups: new Map([
            [p1, {} as any],
            [p2, {} as any],
          ]),
        }
      })

      asMockedFunction(registerGame).mockResolvedValue({
        gameId: 'game-extend',
        resultCodes: new Map([
          [p1, 'code-1'],
          [p2, 'code-2'],
        ]),
      } as any)

      const request: GameLoadRequest = {
        players: [player1.player, player2.player],
        playerInfos: [player1.playerInfo, player2.playerInfo],
        mapId,
        gameConfig: lobbyConfig([
          [{ id: p1, race: 't', isComputer: false }],
          [{ id: p2, race: 'z', isComputer: false }],
        ]),
      }

      const resultPromise = gameLoader.loadGame(request)

      // Drain the load's async setup (all awaited work resolves on already-resolved promises), so
      // the provisioning callback runs and extends the deadline before we cross the base timeout.
      for (let i = 0; i < 100; i++) {
        await Promise.resolve()
      }
      expect(publisher.publish).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ type: 'setLoadingStatus' }),
      )

      // The base timeout (75s) would cancel here without the extension.
      await vi.advanceTimersByTimeAsync(80_000)
      const canceled = publisher.publish.mock.calls.some(
        (call: any[]) => call[1]?.type === 'cancelLoading',
      )
      expect(canceled).toBe(false)

      gameLoader.registerGameAsLoaded('game-extend', p1)
      gameLoader.registerGameAsLoaded('game-extend', p2)
      const result = await resultPromise
      expect(result.isOk()).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })
})
