import { beforeEach, describe, expect, test, vi } from 'vitest'
import { GameConfigPlayer, GameSource, LobbyGameConfig } from '../../../common/games/configuration'
import { GameType } from '../../../common/games/game-type'
import { makeSbMapId } from '../../../common/maps'
import { asMockedFunction } from '../../../common/testing/mocks'
import { makeSbUserId } from '../../../common/users/sb-user-id'
import { createGameUserRecord } from '../models/games-users'
import { createGameRecord } from './game-models'
import { registerGame } from './registration'

vi.mock('../db/transaction', () => ({
  default: vi.fn(async (fn: (client: unknown) => Promise<unknown>) => fn({})),
}))
vi.mock('./game-models', () => ({
  createGameRecord: vi.fn().mockResolvedValue('game-1'),
}))
vi.mock('../models/games-users', () => ({
  createGameUserRecord: vi.fn().mockResolvedValue(undefined),
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

describe('games/registration/registerGame', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    asMockedFunction(createGameRecord).mockResolvedValue('game-1')
    asMockedFunction(createGameUserRecord).mockResolvedValue({} as any)
  })

  test('sets resultsExempt: true on the persisted config when any team has a computer player', async () => {
    const config = lobbyConfig([
      [{ id: p1, race: 't', isComputer: false }],
      [{ id: p2, race: 'z', isComputer: true }],
    ])

    await registerGame(mapId, config)

    expect(asMockedFunction(createGameRecord)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ config: expect.objectContaining({ resultsExempt: true }) }),
    )
  })

  test('sets resultsExempt: false on the persisted config for an all-human game', async () => {
    const config = lobbyConfig([
      [{ id: p1, race: 't', isComputer: false }],
      [{ id: p2, race: 'z', isComputer: false }],
    ])

    await registerGame(mapId, config)

    expect(asMockedFunction(createGameRecord)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ config: expect.objectContaining({ resultsExempt: false }) }),
    )
  })

  test('only creates game-user records for human players, regardless of the exemption flag', async () => {
    const config = lobbyConfig([
      [{ id: p1, race: 't', isComputer: false }],
      [{ id: p2, race: 'z', isComputer: true }],
    ])

    await registerGame(mapId, config)

    expect(asMockedFunction(createGameUserRecord)).toHaveBeenCalledTimes(1)
    expect(asMockedFunction(createGameUserRecord)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ userId: p1 }),
    )
  })
})
