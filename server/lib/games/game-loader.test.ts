import { register } from 'prom-client'
import { afterEach, beforeEach, describe, expect, Mock, test, vi } from 'vitest'
import { makeGameServerRegionId } from '../../../common/game-server-regions'
import { GameConfigPlayer, GameSource, LobbyGameConfig } from '../../../common/games/configuration'
import { PlayerInfo } from '../../../common/games/game-launch-config'
import { GameType } from '../../../common/games/game-type'
import { SlotType } from '../../../common/lobbies/slot'
import { makeSbMapId, MapInfo, MapVisibility } from '../../../common/maps'
import { BwUserLatency } from '../../../common/network'
import { asMockedFunction } from '../../../common/testing/mocks'
import { SbUser } from '../../../common/users/sb-user'
import { makeSbUserId, SbUserId } from '../../../common/users/sb-user-id'
import { getMapInfos } from '../maps/map-models'
import { deleteUserRecordsForGame } from '../models/games-users'
import { findUsersById } from '../users/user-model'
import {
  BaseGameLoaderError,
  GameLoader,
  GameLoadErrorType,
  GameLoadPlayer,
  GameLoadRequest,
} from './game-loader'
import { deleteRecordForGame, updateGameConfig } from './game-models'
import { registerGame } from './registration'

vi.mock('./registration', () => ({
  registerGame: vi.fn(),
}))
vi.mock('./game-models', () => ({
  updateGameConfig: vi.fn().mockResolvedValue(undefined),
  deleteRecordForGame: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../models/games-users', () => ({
  deleteUserRecordsForGame: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../maps/map-models', () => ({
  getMapInfos: vi.fn(),
}))
vi.mock('../users/user-model', () => ({
  findUsersById: vi.fn(),
}))

const p1 = makeSbUserId(1)
const p2 = makeSbUserId(2)
const mapId = makeSbMapId('1')

/** How long a load has to finish before the loader starts deciding whether anyone is at fault. */
const LOAD_DEADLINE_MS = 75_000
/**
 * How long past that deadline the loader keeps asking the coordinator for a record complete enough
 * to attribute the failure to someone.
 */
const FRESHNESS_WAIT_MS = 15_000

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
    uploadedBy: p1,
    uploadDate: new Date(0),
    visibility: MapVisibility.Public,
    mapData: {} as any,
    imageVersion: 1,
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
        signal: AbortSignal
        onProvisioning?: (regions: string[]) => void
      }) => Promise<{ session: number; setups: Map<SbUserId, unknown> }>
    >
    fetchSessionLoadState: Mock<
      (session: number) => Promise<{
        known: boolean
        freshAsOfMs?: number
        startedAtMs?: number
        connectedSlots: number[]
        startedSlots: number[]
      }>
    >
  }
  let gameLoader: GameLoader

  beforeEach(() => {
    vi.clearAllMocks()
    register.clear()

    asMockedFunction(getMapInfos).mockResolvedValue([makeMapInfo()])
    asMockedFunction(deleteRecordForGame).mockResolvedValue(undefined)
    asMockedFunction(deleteUserRecordsForGame).mockResolvedValue(undefined)
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

    gameLoader = new GameLoader(
      publisher as any,
      activityRegistry as any,
      restrictionService as any,
      netcodeV2Service as any,
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
  async function startNetworkedLoad(gameId: string) {
    const player1 = makePlayer(p1)
    const player2 = makePlayer(p2)
    registerActiveClients([player1.player, player2.player])
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
      gameConfig: lobbyConfig([
        [{ id: p1, race: 't', isComputer: false }],
        [{ id: p2, race: 'z', isComputer: false }],
      ]),
    })

    // Every awaited step of the setup resolves on an already-resolved promise, so draining the
    // microtask queue is enough to get the load fully armed.
    for (let i = 0; i < 100; i++) {
      await Promise.resolve()
    }

    return { load }
  }

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
    await vi.advanceTimersByTimeAsync(LOAD_DEADLINE_MS + FRESHNESS_WAIT_MS + 5_000)
    const result = await load
    expect(result.isError()).toBe(true)
    const error = result.errorOrNull() as BaseGameLoaderError<GameLoadErrorType.Timeout>
    expect(error.code).toBe(GameLoadErrorType.Timeout)
    return error
  }

  describe('load deadline attribution', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })
    afterEach(() => {
      vi.useRealTimers()
    })

    /**
     * A coordinator that has held the session since creation, whose record is complete as of every
     * moment it's asked, and that saw nothing beyond what the webhooks already delivered.
     */
    function coordinatorConfirmsComplete() {
      netcodeV2Service.fetchSessionLoadState.mockImplementation(async () => ({
        known: true,
        freshAsOfMs: Date.now(),
        connectedSlots: [],
        startedSlots: [],
      }))
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
      netcodeV2Service.fetchSessionLoadState.mockImplementation(async () => ({
        known: true,
        freshAsOfMs: Date.now(),
        connectedSlots: [0],
        startedSlots: [],
      }))
      const { load } = await startNetworkedLoad('game-pull-connected')

      const error = await expectTimeout(load)

      // Slot 0 is p1, so only p2 is unaccounted for even though no webhook ever arrived.
      expect(netcodeV2Service.fetchSessionLoadState).toHaveBeenCalledWith(77)
      expect(error.data.unloaded).toEqual([p2])
    })

    test('completes the load when the coordinator pull shows every game loop running', async () => {
      netcodeV2Service.fetchSessionLoadState.mockResolvedValue({
        known: true,
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

    test('completes once the record catches up to a start it had not recorded at the deadline', async () => {
      netcodeV2Service.fetchSessionLoadState
        .mockImplementationOnce(async () => ({
          known: true,
          // Complete only up to well before the deadline, so p2 not being in it means nothing yet.
          freshAsOfMs: Date.now() - 10_000,
          connectedSlots: [0, 1],
          startedSlots: [0],
        }))
        .mockImplementation(async () => ({
          known: true,
          freshAsOfMs: Date.now(),
          startedAtMs: Date.now() - 20_000,
          connectedSlots: [0, 1],
          startedSlots: [0, 1],
        }))
      const { load } = await startNetworkedLoad('game-record-catches-up')

      await vi.advanceTimersByTimeAsync(LOAD_DEADLINE_MS + FRESHNESS_WAIT_MS + 5_000)
      const result = await load

      expect(result.isOk()).toBe(true)
      expect(wasCancelPublished()).toBe(false)
      expect(netcodeV2Service.fetchSessionLoadState).toHaveBeenCalledTimes(2)
    })

    test('blames the player still missing once the record covers the deadline', async () => {
      netcodeV2Service.fetchSessionLoadState
        .mockImplementationOnce(async () => ({
          known: true,
          freshAsOfMs: Date.now() - 10_000,
          connectedSlots: [0],
          startedSlots: [],
        }))
        .mockImplementation(async () => ({
          known: true,
          freshAsOfMs: Date.now(),
          connectedSlots: [0],
          startedSlots: [],
        }))
      const { load } = await startNetworkedLoad('game-record-still-missing')

      const error = await expectTimeout(load)

      expect(error.data.unloaded).toEqual([p2])
      // The second pull is what decided it, so the wait cost one poll interval and no more.
      expect(netcodeV2Service.fetchSessionLoadState).toHaveBeenCalledTimes(2)
    })

    test('blames nobody when the record never catches up to the deadline', async () => {
      netcodeV2Service.fetchSessionLoadState.mockImplementation(async () => ({
        known: true,
        // A relay the coordinator can't reach leaves the record stuck short of the deadline.
        freshAsOfMs: Date.now() - 30_000,
        connectedSlots: [0],
        startedSlots: [],
      }))
      const { load } = await startNetworkedLoad('game-record-never-fresh')
      const startedAt = Date.now()

      await vi.advanceTimersByTimeAsync(LOAD_DEADLINE_MS + FRESHNESS_WAIT_MS - 3_000)

      // Still asking: p2's absence isn't evidence until the record covers the deadline.
      expect(wasCancelPublished()).toBe(false)

      await vi.advanceTimersByTimeAsync(5_000)
      const result = await load

      expect(result.isError()).toBe(true)
      const error = result.errorOrNull() as BaseGameLoaderError<GameLoadErrorType.Timeout>
      expect(error.code).toBe(GameLoadErrorType.Timeout)
      expect(error.data.unloaded).toEqual([])
      expect(Date.now() - startedAt).toBeGreaterThanOrEqual(LOAD_DEADLINE_MS + FRESHNESS_WAIT_MS)
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

    test('decides on the pull after a failed one, once its record covers the deadline', async () => {
      netcodeV2Service.fetchSessionLoadState
        .mockRejectedValueOnce(new Error('coordinator down'))
        .mockImplementation(async () => ({
          known: true,
          freshAsOfMs: Date.now(),
          connectedSlots: [0],
          startedSlots: [],
        }))
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
    // unknown game — there's simply nothing left to record.
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
