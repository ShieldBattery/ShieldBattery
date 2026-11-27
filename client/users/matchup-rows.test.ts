import { describe, expect, test } from 'vitest'
import { ladderMatchupRows, MatchupRecordData, playerMatchupRows } from './matchup-rows'

function record(races: string, opponentRaces: string, wins: number, losses: number) {
  return { races, opponentRaces, wins, losses } satisfies MatchupRecordData
}

describe('playerMatchupRows', () => {
  test('sorts by games and pairs each row with the ladder rate from the same side', () => {
    const rows = playerMatchupRows(
      [record('p', 't', 3, 1), record('p', 'z', 10, 5), record('p', 'p', 1, 1)],
      [record('p', 'z', 60, 40), record('z', 'p', 40, 60), record('p', 't', 5, 5)],
    )

    expect(rows.map(r => `${r.races}-${r.opponentRaces}`)).toEqual(['p-z', 'p-t', 'p-p'])
    expect(rows[0]).toMatchObject({ games: 15, wins: 10, losses: 5, ladderWinRate: 0.6 })
    expect(rows[0].winRate).toBeCloseTo(2 / 3)
    // Too few ladder games for a rate
    expect(rows[1].ladderWinRate).toBeUndefined()
    // A player's mirror is their own record; the ladder has no rate for it
    expect(rows[2]).toMatchObject({ winRate: 0.5, ladderWinRate: undefined })
  })
})

describe('ladderMatchupRows', () => {
  test('lists each pair of sides once and gives mirrors a game count only', () => {
    const rows = ladderMatchupRows([
      record('p', 'z', 60, 40),
      record('z', 'p', 40, 60),
      record('t', 't', 30, 30),
      record('pt', 'zz', 4, 6),
      record('zz', 'pt', 6, 4),
    ])

    expect(rows).toEqual([
      { races: 'p', opponentRaces: 'z', games: 100, wins: 60, losses: 40, winRate: 0.6 },
      { races: 't', opponentRaces: 't', games: 30 },
      { races: 'pt', opponentRaces: 'zz', games: 10, wins: 4, losses: 6, winRate: undefined },
    ])
  })
})
