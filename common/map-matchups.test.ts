import { describe, expect, test } from 'vitest'
import { compositionWinRates, isMirrorMatchup, matchupWinRates } from './map-matchups'

describe('common/map-matchups', () => {
  test('detects mirror matchups', () => {
    expect(isMirrorMatchup('p-p')).toBe(true)
    expect(isMirrorMatchup('pt-pt')).toBe(true)
    expect(isMirrorMatchup('p-z')).toBe(false)
    expect(isMirrorMatchup('pt-tz')).toBe(false)
  })

  test('gives a matchup winrate from each side once it has enough games', () => {
    expect(matchupWinRates({ matchup: 'p-z', games: 40, leftWins: 30, rightWins: 10 })).toEqual({
      left: 0.75,
      right: 0.25,
    })
  })

  test('hides matchup winrates below the minimum and for mirrors', () => {
    expect(matchupWinRates({ matchup: 'p-z', games: 19, leftWins: 10, rightWins: 9 })).toBe(
      undefined,
    )
    expect(matchupWinRates({ matchup: 'p-p', games: 100, leftWins: 0, rightWins: 0 })).toBe(
      undefined,
    )
    expect(
      matchupWinRates({ matchup: 'p-z', games: 5, leftWins: 3, rightWins: 2 }, 5),
    ).toBeDefined()
  })

  test('totals each composition over both sides of every matchup it played', () => {
    const result = compositionWinRates(
      [
        { matchup: 'pt-tz', games: 30, leftWins: 20, rightWins: 10 },
        { matchup: 'pt-zz', games: 10, leftWins: 4, rightWins: 6 },
        { matchup: 'tz-zz', games: 20, leftWins: 10, rightWins: 10 },
      ],
      20,
    )

    expect(result).toEqual(
      [
        { composition: 'pt', games: 40, wins: 24, winRate: 0.6 },
        { composition: 'tz', games: 50, wins: 20, winRate: 0.4 },
        { composition: 'zz', games: 30, wins: 16, winRate: 16 / 30 },
      ].sort((a, b) => b.winRate - a.winRate),
    )
  })

  test('leaves mirrors out of composition totals', () => {
    const result = compositionWinRates(
      [
        { matchup: 'pt-pt', games: 50, leftWins: 0, rightWins: 0 },
        { matchup: 'pt-tz', games: 20, leftWins: 15, rightWins: 5 },
      ],
      20,
    )

    expect(result.find(r => r.composition === 'pt')).toEqual({
      composition: 'pt',
      games: 20,
      wins: 15,
      winRate: 0.75,
    })
  })

  test('sorts compositions without a winrate last, by games', () => {
    const result = compositionWinRates(
      [
        { matchup: 'pp-tt', games: 25, leftWins: 10, rightWins: 15 },
        { matchup: 'pz-zz', games: 8, leftWins: 4, rightWins: 4 },
        { matchup: 'pz-tz', games: 3, leftWins: 1, rightWins: 2 },
      ],
      20,
    )

    expect(result.map(r => r.composition)).toEqual(['tt', 'pp', 'pz', 'zz', 'tz'])
    expect(result.slice(2).every(r => r.winRate === undefined)).toBe(true)
  })
})
