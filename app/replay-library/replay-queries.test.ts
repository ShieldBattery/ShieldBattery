import { describe, expect, test } from 'vitest'
import {
  decodeMatchup,
  GameDurationFilter,
  makeEncodedMatchupString,
} from '../../common/games/game-filters'
import { RaceChar } from '../../common/races'
import { ReplayLibraryPlayer } from '../../common/replays-library'
import {
  buildFtsMatchQuery,
  buildReplaySqlQuery,
  getReplayTeamRaces,
  replayMatchesFormat,
  replayMatchesMatchup,
  replayPassesTeamFilters,
} from './replay-queries'

function player(
  team: number,
  race: RaceChar,
  overrides: Partial<ReplayLibraryPlayer> = {},
): ReplayLibraryPlayer {
  return { slot: 0, team, race, name: 'p', isComputer: false, ...overrides }
}

describe('app/replay-library/replay-queries/buildFtsMatchQuery', () => {
  test('undefined/empty query returns undefined', () => {
    expect(buildFtsMatchQuery(undefined)).toBeUndefined()
    expect(buildFtsMatchQuery('')).toBeUndefined()
    expect(buildFtsMatchQuery('   ')).toBeUndefined()
  })

  test('builds quoted prefix tokens joined with AND (space)', () => {
    expect(buildFtsMatchQuery('flash')).toBe('"flash"*')
    expect(buildFtsMatchQuery('  neo   sylphid ')).toBe('"neo"* "sylphid"*')
  })

  test('escapes embedded double quotes', () => {
    expect(buildFtsMatchQuery('a"b')).toBe('"a""b"*')
  })
})

describe('app/replay-library/replay-queries/buildReplaySqlQuery', () => {
  test('no filters yields a plain newest-first query', () => {
    const { sql, params } = buildReplaySqlQuery({})
    expect(sql).toBe('SELECT r.* FROM replays r ORDER BY r.game_time DESC')
    expect(params).toEqual([])
  })

  test('source sb / bnet map to null checks with no params', () => {
    expect(buildReplaySqlQuery({ source: 'sb' }).sql).toContain('r.sb_game_id IS NOT NULL')
    expect(buildReplaySqlQuery({ source: 'bnet' }).sql).toContain('r.sb_game_id IS NULL')
    expect(buildReplaySqlQuery({ source: 'sb' }).params).toEqual([])
  })

  test('map name and game type become parameterized equality checks', () => {
    const { sql, params } = buildReplaySqlQuery({ mapName: 'Fighting Spirit', gameType: 2 })
    expect(sql).toContain('r.map_name = ?')
    expect(sql).toContain('r.game_type = ?')
    expect(params).toEqual(['Fighting Spirit', 2])
  })

  test('duration buckets convert to frame thresholds (24 fps)', () => {
    expect(buildReplaySqlQuery({ duration: GameDurationFilter.Under10 }).params).toEqual([14400])
    expect(buildReplaySqlQuery({ duration: GameDurationFilter.From10To20 }).params).toEqual([
      14400, 28800,
    ])
    expect(buildReplaySqlQuery({ duration: GameDurationFilter.From20To30 }).params).toEqual([
      28800, 43200,
    ])
    expect(buildReplaySqlQuery({ duration: GameDurationFilter.Over30 }).params).toEqual([43200])
  })

  test('duration "all" is a no-op', () => {
    expect(buildReplaySqlQuery({ duration: GameDurationFilter.All }).params).toEqual([])
    expect(buildReplaySqlQuery({ duration: GameDurationFilter.All }).sql).not.toContain(
      'duration_frames',
    )
  })

  test('search adds an FTS join and match param first', () => {
    const { sql, params } = buildReplaySqlQuery({ searchQuery: 'flash', mapName: 'Python' })
    expect(sql).toContain('JOIN replay_fts ON replay_fts.rowid = r.id')
    expect(sql).toContain('replay_fts MATCH ?')
    // FTS match param comes before the other row-level params.
    expect(params).toEqual(['"flash"*', 'Python'])
  })
})

describe('app/replay-library/replay-queries/getReplayTeamRaces', () => {
  test('two teams are returned as-is', () => {
    expect(getReplayTeamRaces([player(0, 'p'), player(1, 'z')])).toEqual([['p'], ['z']])
  })

  test('single team of two is split into two teams', () => {
    expect(getReplayTeamRaces([player(0, 'p'), player(0, 'z')])).toEqual([['p'], ['z']])
  })

  test('single team of more than two cannot be resolved', () => {
    expect(getReplayTeamRaces([player(0, 'p'), player(0, 'z'), player(0, 't')])).toBeNull()
  })

  test('four players across two teams', () => {
    const teams = getReplayTeamRaces([
      player(1, 'p'),
      player(1, 't'),
      player(2, 'z'),
      player(2, 'z'),
    ])
    expect(teams).toEqual([
      ['p', 't'],
      ['z', 'z'],
    ])
  })
})

describe('app/replay-library/replay-queries/replayMatchesFormat', () => {
  test('1v1 matches a two-team, one-per-team replay', () => {
    expect(replayMatchesFormat([player(0, 'p'), player(1, 'z')], '1v1')).toBe(true)
  })

  test('2v2 does not match a 1v1', () => {
    expect(replayMatchesFormat([player(0, 'p'), player(1, 'z')], '2v2')).toBe(false)
  })

  test('2v2 matches four players across two teams', () => {
    expect(
      replayMatchesFormat([player(1, 'p'), player(1, 't'), player(2, 'z'), player(2, 'z')], '2v2'),
    ).toBe(true)
  })
})

describe('app/replay-library/replay-queries/replayMatchesMatchup', () => {
  const players = [player(0, 'p'), player(1, 'z')]

  test('exact matchup matches (team-order-agnostic)', () => {
    expect(
      replayMatchesMatchup(players, decodeMatchup('1v1', makeEncodedMatchupString('p-z'))!),
    ).toBe(true)
    // Reversed order still matches, since the canonical form sorts teams.
    expect(
      replayMatchesMatchup(players, decodeMatchup('1v1', makeEncodedMatchupString('z-p'))!),
    ).toBe(true)
  })

  test('wildcard slot matches any race', () => {
    expect(
      replayMatchesMatchup(players, decodeMatchup('1v1', makeEncodedMatchupString('p-_'))!),
    ).toBe(true)
  })

  test('non-matching matchup is rejected', () => {
    expect(
      replayMatchesMatchup(players, decodeMatchup('1v1', makeEncodedMatchupString('p-t'))!),
    ).toBe(false)
  })
})

describe('app/replay-library/replay-queries/replayPassesTeamFilters', () => {
  const players = [player(0, 'p'), player(1, 'z')]

  test('no format filter always passes', () => {
    expect(replayPassesTeamFilters(players, {})).toBe(true)
  })

  test('format-only filter applies the team shape', () => {
    expect(replayPassesTeamFilters(players, { format: '1v1' })).toBe(true)
    expect(replayPassesTeamFilters(players, { format: '2v2' })).toBe(false)
  })

  test('fully-wildcard matchup is treated as format-only', () => {
    expect(
      replayPassesTeamFilters(players, {
        format: '1v1',
        matchup: makeEncodedMatchupString('_-_'),
      }),
    ).toBe(true)
  })

  test('constrained matchup is enforced', () => {
    expect(
      replayPassesTeamFilters(players, {
        format: '1v1',
        matchup: makeEncodedMatchupString('p-z'),
      }),
    ).toBe(true)
    expect(
      replayPassesTeamFilters(players, {
        format: '1v1',
        matchup: makeEncodedMatchupString('t-z'),
      }),
    ).toBe(false)
  })
})
