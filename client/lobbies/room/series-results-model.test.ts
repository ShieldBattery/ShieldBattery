import { describe, expect, test } from 'vitest'
import { LobbyBestOfJson, LobbyBestOfSides } from '../../../common/lobbies/lobby-best-of'
import { LobbySeriesGameJson, LobbySeriesTeamJson } from '../../../common/lobbies/lobby-network'
import { SbMapId } from '../../../common/maps'
import { makeSbUserId } from '../../../common/users/sb-user-id'
import {
  getSeriesResultRows,
  getSeriesResultStrip,
  getSeriesRosters,
  SeriesMemberResult,
} from './series-results-model'

const ALICE = makeSbUserId(1)
const BOB = makeSbUserId(2)
const CAROL = makeSbUserId(3)
const DAVE = makeSbUserId(4)
const ERIN = makeSbUserId(5)
const FRANK = makeSbUserId(6)

const MAP = 'map' as SbMapId

/** A finished game between the given teams, which every human of team 1 won. */
function record(gameId: string, teams: LobbySeriesTeamJson[], durationMs = 60000) {
  const outcomes = teams.flatMap((team, i) =>
    team.players.flatMap(player =>
      player.type === 'human'
        ? [{ userId: player.userId, result: i === 0 ? ('win' as const) : ('loss' as const) }]
        : [],
    ),
  )
  return {
    gameId,
    mapId: MAP,
    teams,
    result: { outcomes, durationMs },
  } satisfies LobbySeriesGameJson
}

function humans(teamId: number, ...userIds: Array<ReturnType<typeof makeSbUserId>>) {
  return {
    teamId,
    players: userIds.map(userId => ({ type: 'human' as const, userId, race: 'z' as const })),
  }
}

/**
 * A best of 5 between two sides of three, each game played by a different pair of them. Dave was
 * moved from side 2 to side 1 after game 2; Frank is on side 2 and hasn't played.
 */
const ROSTERED: LobbyBestOfJson = {
  id: 'series',
  length: 5,
  sides: [
    [ALICE, CAROL, DAVE],
    [BOB, ERIN, FRANK],
  ],
  games: [
    {
      gameId: 'g1',
      players: [
        [ALICE, CAROL],
        [BOB, DAVE],
      ],
      status: 'won',
      winner: 0,
    },
    {
      gameId: 'g2',
      players: [
        [ALICE, CAROL],
        [BOB, DAVE],
      ],
      status: 'notCounted',
    },
    {
      gameId: 'g3',
      players: [
        [ALICE, DAVE],
        [BOB, ERIN],
      ],
      status: 'won',
      winner: 1,
    },
    {
      gameId: 'g4',
      players: [
        [ALICE, DAVE],
        [ERIN, BOB],
      ],
      status: 'noWinner',
    },
  ],
}

describe('getSeriesRosters', () => {
  test('credits each game to the people who played it for a side, in the order played', () => {
    const [side1, side2] = getSeriesRosters(ROSTERED)

    expect(side1.map(m => [m.userId, m.results])).toEqual([
      [ALICE, ['win', 'loss']],
      [CAROL, ['win']],
      [DAVE, ['loss']],
    ])
    expect(side2.map(m => [m.userId, m.results])).toEqual([
      [BOB, ['loss', 'win']],
      [ERIN, ['win']],
      [FRANK, []],
      [DAVE, ['loss']],
    ])
  })

  test('lists someone who never played among their side, without results', () => {
    const frank = getSeriesRosters(ROSTERED)[1].find(m => m.userId === FRANK)!
    expect(frank).toEqual({ userId: FRANK, isOnSide: true, results: [], gamesPlayed: 0 })
  })

  test('lists someone moved to the other side on both, after the current members of the old one', () => {
    const [side1, side2] = getSeriesRosters(ROSTERED)
    expect(side1.find(m => m.userId === DAVE)).toEqual({
      userId: DAVE,
      isOnSide: true,
      results: ['loss'],
      gamesPlayed: 2,
    })
    expect(side2.at(-1)).toEqual({
      userId: DAVE,
      isOnSide: false,
      results: ['loss'],
      gamesPlayed: 2,
    })
  })

  test('leaves the games that did not count out of everyone’s results', () => {
    const carol = getSeriesRosters(ROSTERED)[0].find(m => m.userId === CAROL)!
    expect(carol.results).toEqual(['win'])
    expect(carol.gamesPlayed).toBe(2)
  })

  test('does not count a game still pending as played', () => {
    const bestOf: LobbyBestOfJson = {
      ...ROSTERED,
      games: [{ gameId: 'g1', players: [[ALICE], [BOB]], status: 'pending' }],
    }
    const [side1] = getSeriesRosters(bestOf)
    expect(side1[0]).toEqual({ userId: ALICE, isOnSide: true, results: [], gamesPlayed: 0 })
  })

  test('counts a game that did not count as played, without a result', () => {
    const bestOf: LobbyBestOfJson = {
      ...ROSTERED,
      games: [{ gameId: 'g1', players: [[ALICE], [BOB]], status: 'notCounted' }],
    }
    const [side1] = getSeriesRosters(bestOf)
    expect(side1[0]).toEqual({ userId: ALICE, isOnSide: true, results: [], gamesPlayed: 1 })
  })

  test('counts only the finished games when another is pending', () => {
    const bestOf: LobbyBestOfJson = {
      ...ROSTERED,
      games: [
        { gameId: 'g1', players: [[ALICE], [BOB]], status: 'won', winner: 0 },
        { gameId: 'g2', players: [[ALICE], [BOB]], status: 'pending' },
      ],
    }
    const [side1] = getSeriesRosters(bestOf)
    expect(side1[0]).toEqual({ userId: ALICE, isOnSide: true, results: ['win'], gamesPlayed: 1 })
  })

  test('goes by how the series counts a game the host set, not by its own outcomes', () => {
    const bestOf: LobbyBestOfJson = {
      ...ROSTERED,
      games: [
        {
          gameId: 'g1',
          players: [[ALICE], [BOB]],
          status: 'won',
          winner: 1,
          setByHost: true,
        },
      ],
    }
    const [side1, side2] = getSeriesRosters(bestOf)
    expect(side1[0].results).toEqual(['loss'])
    expect(side2[0].results).toEqual(['win'])
  })

  test('gives nobody a result added by hand', () => {
    const bestOf: LobbyBestOfJson = {
      ...ROSTERED,
      games: [{ resultId: 'r1', status: 'won', winner: 0 }],
    }
    const [side1, side2] = getSeriesRosters(bestOf)
    expect([...side1, ...side2].every(m => m.results.length === 0)).toBe(true)
  })
})

describe('getSeriesResultRows', () => {
  const teams1 = [humans(1, ALICE, CAROL), humans(2, BOB, DAVE)]

  test('lists every game in order, a game that did not count among them', () => {
    const rows = getSeriesResultRows(ROSTERED, [record('g1', teams1), record('g2', teams1)])

    expect(rows.map(row => [row.kind, row.gameNumber])).toEqual([
      ['game', 1],
      ['game', 2],
      ['game', 2],
      ['game', 3],
    ])
    expect(rows.map(row => row.kind === 'game' && row.status)).toEqual([
      { kind: 'won', winner: 0, setByHost: false },
      { kind: 'notCounted' },
      { kind: 'won', winner: 1, setByHost: false },
      { kind: 'notCounted' },
    ])
  })

  test('lists who played each game for each side, with races from the game’s record', () => {
    const rows = getSeriesResultRows(ROSTERED, [record('g1', teams1, 754000)])
    const first = rows[0]
    expect(first).toMatchObject({
      kind: 'game',
      gameId: 'g1',
      hasRecord: true,
      mapId: MAP,
      durationMs: 754000,
    })
    expect(first.kind === 'game' && first.players).toEqual([
      [
        { kind: 'human', userId: ALICE, race: 'z' },
        { kind: 'human', userId: CAROL, race: 'z' },
      ],
      [
        { kind: 'human', userId: BOB, race: 'z' },
        { kind: 'human', userId: DAVE, race: 'z' },
      ],
    ])
  })

  test('shows the side the host gave a game to, against its own outcomes', () => {
    const bestOf: LobbyBestOfJson = {
      ...ROSTERED,
      games: [
        {
          gameId: 'g1',
          players: [
            [ALICE, CAROL],
            [BOB, DAVE],
          ],
          status: 'won',
          winner: 1,
          setByHost: true,
        },
      ],
    }
    // The game's own outcomes say side 1 won it.
    const [row] = getSeriesResultRows(bestOf, [record('g1', teams1)])
    expect(row.kind === 'game' && row.status).toEqual({ kind: 'won', winner: 1, setByHost: true })
  })

  test('lists a result added by hand with no players, and numbers the games after it on', () => {
    const bestOf: LobbyBestOfJson = {
      ...ROSTERED,
      games: [{ resultId: 'r1', status: 'won', winner: 1 }, ...ROSTERED.games],
    }
    const rows = getSeriesResultRows(bestOf, [])
    expect(rows[0]).toEqual({
      kind: 'addedResult',
      key: 'added-r1',
      resultId: 'r1',
      gameNumber: 1,
      winner: 1,
    })
    expect(rows.slice(1).map(row => row.gameNumber)).toEqual([2, 3, 3, 4])
  })

  test('tells a game waiting for its result from one still being played', () => {
    const players: LobbyBestOfSides = [[ALICE], [BOB]]
    const bestOf: LobbyBestOfJson = {
      ...ROSTERED,
      games: [
        { gameId: 'g1', players, status: 'pending' },
        { gameId: 'g2', players, status: 'pending' },
      ],
    }
    const rows = getSeriesResultRows(
      bestOf,
      [record('g1', [humans(1, ALICE), humans(2, BOB)])],
      'g2',
    )

    expect(rows[0]).toMatchObject({ status: { kind: 'waiting' }, hasRecord: true })
    expect(rows[1]).toMatchObject({ status: { kind: 'playing' }, hasRecord: false })
    expect(rows[1].kind === 'game' && rows[1].players).toEqual([
      [{ kind: 'human', userId: ALICE, race: undefined }],
      [{ kind: 'human', userId: BOB, race: undefined }],
    ])
    expect(rows[1]).not.toHaveProperty('mapId')
    expect(rows[1]).not.toHaveProperty('durationMs')
  })

  test('puts a team’s computers on the side of its humans, after them', () => {
    const bestOf: LobbyBestOfJson = {
      ...ROSTERED,
      games: [{ gameId: 'g1', players: [[ALICE], [BOB]], status: 'won', winner: 0 }],
    }
    const teams: LobbySeriesTeamJson[] = [
      { teamId: 1, players: [{ type: 'computer', race: 'p' }, ...humans(1, ALICE).players] },
      { teamId: 2, players: [...humans(2, BOB).players, { type: 'computer', race: 't' }] },
      { teamId: 3, players: [{ type: 'computer', race: 'z' }] },
    ]
    const [row] = getSeriesResultRows(bestOf, [record('g1', teams)])
    expect(row.kind === 'game' && row.players).toEqual([
      [
        { kind: 'human', userId: ALICE, race: 'z' },
        { kind: 'computer', race: 'p' },
      ],
      [
        { kind: 'human', userId: BOB, race: 'z' },
        { kind: 'computer', race: 't' },
      ],
    ])
  })

  test('leaves the computers of a single-team game out', () => {
    const bestOf: LobbyBestOfJson = {
      ...ROSTERED,
      games: [{ gameId: 'g1', players: [[ALICE], [BOB]], status: 'won', winner: 0 }],
    }
    const teams: LobbySeriesTeamJson[] = [
      {
        teamId: 0,
        players: [
          ...humans(0, ALICE, BOB).players,
          { type: 'computer', race: 'p' },
          { type: 'computer', race: 't' },
        ],
      },
    ]
    const [row] = getSeriesResultRows(bestOf, [record('g1', teams)])
    expect(row.kind === 'game' && row.players).toEqual([
      [{ kind: 'human', userId: ALICE, race: 'z' }],
      [{ kind: 'human', userId: BOB, race: 'z' }],
    ])
  })
})

describe('getSeriesResultStrip', () => {
  const W: SeriesMemberResult = 'win'
  const L: SeriesMemberResult = 'loss'

  test('shows up to 7 results one by one', () => {
    expect(getSeriesResultStrip([])).toEqual({ kind: 'all', results: [] })
    expect(getSeriesResultStrip([W, L, W, W, L, L, W])).toEqual({
      kind: 'all',
      results: [W, L, W, W, L, L, W],
    })
  })

  test('sums up more than 7 in a tally, then shows the last 5', () => {
    expect(getSeriesResultStrip([L, W, L, L, W, W, L, W])).toEqual({
      kind: 'tally',
      wins: 4,
      losses: 4,
      recent: [L, W, W, L, W],
    })
  })
})
