import { beforeEach, describe, expect, test, vi } from 'vitest'
import { GameConfigPlayer, GameSource, LobbyGameConfig } from '../../../common/games/configuration'
import { GameType } from '../../../common/games/game-type'
import { makeSbMapId } from '../../../common/maps'
import { asMockedFunction } from '../../../common/testing/mocks'
import { SbUserId, makeSbUserId } from '../../../common/users/sb-user-id'
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
const p3 = makeSbUserId(3)
const p4 = makeSbUserId(4)
const mapId = makeSbMapId('1')

/** The `team` value the given user's record was created with. */
function teamFor(userId: SbUserId): number | null | undefined {
  const call = asMockedFunction(createGameUserRecord).mock.calls.find(
    ([, data]) => data.userId === userId,
  )
  return call?.[1].team
}

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

  test('sets resultsExempt: false on the persisted config for a 2-human game', async () => {
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

  test('sets resultsExempt: true on the persisted config for a solo (no-AI) game', async () => {
    const config = lobbyConfig([[{ id: p1, race: 't', isComputer: false }]])

    await registerGame(mapId, config)

    expect(asMockedFunction(createGameRecord)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ config: expect.objectContaining({ resultsExempt: true }) }),
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

  test('records each player’s team index', async () => {
    const config = lobbyConfig([
      [
        { id: p1, race: 't', isComputer: false },
        { id: p3, race: 'p', isComputer: false },
      ],
      [
        { id: p2, race: 'z', isComputer: false },
        { id: p4, race: 'p', isComputer: false },
      ],
    ])

    await registerGame(mapId, config)

    expect(teamFor(p1)).toBe(0)
    expect(teamFor(p3)).toBe(0)
    expect(teamFor(p2)).toBe(1)
    expect(teamFor(p4)).toBe(1)
  })

  test('records teams for a 1v1 split out of a single two-player team', async () => {
    // `getTeamsFromConfig` splits this shape into two teams of one, and the team recorded has to
    // follow that same split -- otherwise a row's team and its game's matchup string would be
    // describing different divisions of the same game.
    const config = lobbyConfig([
      [
        { id: p1, race: 't', isComputer: false },
        { id: p2, race: 'z', isComputer: false },
      ],
    ])

    await registerGame(mapId, config)

    expect(teamFor(p1)).toBe(0)
    expect(teamFor(p2)).toBe(1)
  })

  test('records no team when the game has none to determine', async () => {
    // Melee with more than two players in one team: `getTeamsFromConfig` gives up, and so does
    // this rather than inventing a division. NULL means unknown, not team zero.
    const config = lobbyConfig([
      [
        { id: p1, race: 't', isComputer: false },
        { id: p2, race: 'z', isComputer: false },
        { id: p3, race: 'p', isComputer: false },
      ],
    ])

    await registerGame(mapId, config)

    expect(teamFor(p1)).toBeNull()
    expect(teamFor(p2)).toBeNull()
    expect(teamFor(p3)).toBeNull()
  })

  test('records the team of a human sharing a team with a computer player', async () => {
    // The computer gets no row, but it does occupy a slot -- the human's team index still has to
    // be its position among the config's teams, not among the rows that got written.
    const config = lobbyConfig([
      [{ id: p1, race: 't', isComputer: true }],
      [{ id: p2, race: 'z', isComputer: false }],
    ])

    await registerGame(mapId, config)

    expect(teamFor(p2)).toBe(1)
  })
})
