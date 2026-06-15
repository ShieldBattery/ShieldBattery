import { describe, expect, test } from 'vitest'
import {
  createEmptyMatchup,
  decodeMatchup,
  encodeMatchup,
  GameFormat,
  getTeamSizeForFormat,
  makeEncodedMatchupString,
  MatchupFilter,
} from './game-filters'

describe('getTeamSizeForFormat', () => {
  test('maps each format to its team size', () => {
    expect(getTeamSizeForFormat('1v1')).toBe(1)
    expect(getTeamSizeForFormat('2v2')).toBe(2)
    expect(getTeamSizeForFormat('3v3')).toBe(3)
    expect(getTeamSizeForFormat('4v4')).toBe(4)
  })
})

describe('createEmptyMatchup', () => {
  test('fills both teams with wildcards sized to the format', () => {
    expect(createEmptyMatchup('1v1')).toEqual({ team1: [undefined], team2: [undefined] })
    expect(createEmptyMatchup('2v2')).toEqual({
      team1: [undefined, undefined],
      team2: [undefined, undefined],
    })
  })

  test('round-trips through encode/decode as an all-wildcard string', () => {
    for (const format of ['1v1', '2v2', '3v3', '4v4'] as GameFormat[]) {
      const empty = createEmptyMatchup(format)
      expect(decodeMatchup(format, encodeMatchup(empty))).toEqual(empty)
    }
  })
})

describe('encodeMatchup', () => {
  test('encodes races and wildcards joined by a dash', () => {
    expect(encodeMatchup({ team1: ['p'], team2: ['z'] })).toBe('p-z')
    expect(encodeMatchup({ team1: [undefined], team2: ['z'] })).toBe('_-z')
    expect(encodeMatchup({ team1: ['p', 't'], team2: ['z', undefined] })).toBe('pt-z_')
  })
})

describe('decodeMatchup', () => {
  test('returns undefined for a missing string', () => {
    expect(decodeMatchup('1v1', undefined)).toBeUndefined()
    expect(decodeMatchup('1v1', makeEncodedMatchupString(''))).toBeUndefined()
  })

  test('decodes races and wildcards', () => {
    expect(decodeMatchup('1v1', makeEncodedMatchupString('p-z'))).toEqual({
      team1: ['p'],
      team2: ['z'],
    })
    expect(decodeMatchup('1v1', makeEncodedMatchupString('_-z'))).toEqual({
      team1: [undefined],
      team2: ['z'],
    })
    expect(decodeMatchup('2v2', makeEncodedMatchupString('pt-z_'))).toEqual({
      team1: ['p', 't'],
      team2: ['z', undefined],
    })
  })

  test('returns undefined when there are not exactly two teams', () => {
    expect(decodeMatchup('1v1', makeEncodedMatchupString('p'))).toBeUndefined()
    expect(decodeMatchup('1v1', makeEncodedMatchupString('p-z-t'))).toBeUndefined()
  })

  test('returns undefined when a team length does not match the format', () => {
    // 1v1 expects one race per team
    expect(decodeMatchup('1v1', makeEncodedMatchupString('pt-z'))).toBeUndefined()
    // 2v2 expects two races per team
    expect(decodeMatchup('2v2', makeEncodedMatchupString('p-z'))).toBeUndefined()
    expect(decodeMatchup('2v2', makeEncodedMatchupString('ptz-zz'))).toBeUndefined()
  })

  test('returns undefined for invalid race characters', () => {
    // 'r' (random) is not a valid assigned race in a matchup
    expect(decodeMatchup('1v1', makeEncodedMatchupString('r-z'))).toBeUndefined()
    expect(decodeMatchup('1v1', makeEncodedMatchupString('x-z'))).toBeUndefined()
    expect(decodeMatchup('1v1', makeEncodedMatchupString('P-z'))).toBeUndefined()
  })

  test('round-trips arbitrary valid matchups', () => {
    const cases: Array<[GameFormat, MatchupFilter]> = [
      ['1v1', { team1: ['p'], team2: ['z'] }],
      ['1v1', { team1: [undefined], team2: [undefined] }],
      ['2v2', { team1: ['p', 'z'], team2: ['t', undefined] }],
      ['3v3', { team1: ['p', undefined, 'z'], team2: ['t', 't', undefined] }],
    ]
    for (const [format, matchup] of cases) {
      expect(decodeMatchup(format, encodeMatchup(matchup))).toEqual(matchup)
    }
  })
})
