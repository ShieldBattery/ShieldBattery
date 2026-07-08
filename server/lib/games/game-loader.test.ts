import { register } from 'prom-client'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { GameConfigPlayer, GameSource, LobbyGameConfig } from '../../../common/games/configuration'
import { PlayerInfo } from '../../../common/games/game-launch-config'
import { GameType } from '../../../common/games/game-type'
import { createHuman, Slot, SlotType } from '../../../common/lobbies/slot'
import { makeSbMapId, MapInfo, MapVisibility } from '../../../common/maps'
import { BwUserLatency } from '../../../common/network'
import { asMockedFunction } from '../../../common/testing/mocks'
import { SbUser } from '../../../common/users/sb-user'
import { makeSbUserId, SbUserId } from '../../../common/users/sb-user-id'
import { getMapInfos } from '../maps/map-models'
import { deleteUserRecordsForGame } from '../models/games-users'
import { findUsersById } from '../users/user-model'
import { BaseGameLoaderError, GameLoader, GameLoadErrorType, GameLoadRequest } from './game-loader'
import { deleteRecordForGame, updateGameConfig, updateRouteDebugInfo } from './game-models'
import { registerGame } from './registration'

vi.mock('./registration', () => ({
  registerGame: vi.fn(),
}))
vi.mock('./game-models', () => ({
  updateGameConfig: vi.fn().mockResolvedValue(undefined),
  deleteRecordForGame: vi.fn().mockResolvedValue(undefined),
  updateRouteDebugInfo: vi.fn().mockResolvedValue(undefined),
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

function lobbyConfig(teams: GameConfigPlayer[][]): LobbyGameConfig {
  return {
    gameSource: GameSource.Lobby,
    gameType: GameType.Melee,
    gameSubType: 0,
    teams,
  }
}

function makePlayer(userId: SbUserId): { slot: Slot; playerInfo: PlayerInfo } {
  const slot = createHuman(userId)
  return {
    slot,
    playerInfo: {
      id: slot.id,
      userId,
      race: slot.race,
      playerId: slot.playerId,
      teamId: 0,
      type: SlotType.Human,
      typeId: slot.typeId,
    },
  }
}

function makeUser(userId: SbUserId): SbUser {
  return { id: userId, name: `user-${userId}` }
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
    discardGame: ReturnType<typeof vi.fn>
    createSessionForGame: ReturnType<typeof vi.fn>
  }
  let gameLoader: GameLoader

  beforeEach(() => {
    vi.clearAllMocks()
    register.clear()

    asMockedFunction(getMapInfos).mockResolvedValue([makeMapInfo()])
    asMockedFunction(deleteRecordForGame).mockResolvedValue(undefined)
    asMockedFunction(deleteUserRecordsForGame).mockResolvedValue(undefined)
    asMockedFunction(updateGameConfig).mockResolvedValue(undefined)
    asMockedFunction(updateRouteDebugInfo).mockResolvedValue(undefined)

    publisher = { publish: vi.fn() }
    activityRegistry = { getClientForUser: vi.fn() }
    restrictionService = { checkMultipleRestrictions: vi.fn().mockResolvedValue([]) }
    netcodeV2Service = {
      isEnabled: vi.fn().mockReturnValue(true),
      discardGame: vi.fn(),
      createSessionForGame: vi.fn().mockResolvedValue(new Map()),
    }

    gameLoader = new GameLoader(
      publisher as any,
      activityRegistry as any,
      restrictionService as any,
      netcodeV2Service as any,
    )
  })

  function registerActiveClients(players: Slot[]) {
    activityRegistry.getClientForUser.mockImplementation((userId: SbUserId) =>
      players.some(p => p.userId === userId) ? makeClient(userId) : undefined,
    )
  }

  test('fails immediately when a multi-human game loads and netcode v2 is not enabled', async () => {
    const player1 = makePlayer(p1)
    const player2 = makePlayer(p2)
    registerActiveClients([player1.slot, player2.slot])
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
      players: [player1.slot, player2.slot],
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
    registerActiveClients([player1.slot])
    asMockedFunction(findUsersById).mockResolvedValue([makeUser(p1)])
    netcodeV2Service.isEnabled.mockReturnValue(false)

    asMockedFunction(registerGame).mockResolvedValue({
      gameId: 'game-solo',
      resultCodes: new Map([[p1, 'code-1']]),
    } as any)

    const request: GameLoadRequest = {
      players: [player1.slot],
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
    registerActiveClients([player1.slot, player2.slot])
    asMockedFunction(findUsersById).mockResolvedValue([makeUser(p1), makeUser(p2)])
    netcodeV2Service.isEnabled.mockReturnValue(true)
    netcodeV2Service.createSessionForGame.mockResolvedValue(
      new Map([
        [p1, {} as any],
        [p2, {} as any],
      ]),
    )

    asMockedFunction(registerGame).mockResolvedValue({
      gameId: 'game-multi',
      resultCodes: new Map([
        [p1, 'code-1'],
        [p2, 'code-2'],
      ]),
    } as any)

    const request: GameLoadRequest = {
      players: [player1.slot, player2.slot],
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
    expect(updateRouteDebugInfo).toHaveBeenCalledWith('game-multi', [])
  })
})
