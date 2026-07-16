import { describe, expect, test } from 'vitest'
import {
  decodeMatchup,
  GameDurationFilter,
  GameSortOption,
  makeEncodedMatchupString,
} from '../../common/games/game-filters'
import { RaceChar } from '../../common/races'
import { ReplayLibraryPlayer } from '../../common/replays-library'
import {
  buildReplaySqlQuery,
  escapeLike,
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

describe('app/replay-library/replay-queries/escapeLike', () => {
  test('leaves plain text untouched', () => {
    expect(escapeLike('Fighting Spirit')).toBe('Fighting Spirit')
  })

  test('escapes backslash, percent, and underscore', () => {
    expect(escapeLike('100%_\\win')).toBe('100\\%\\_\\\\win')
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

  test('map name becomes a case-insensitive substring LIKE check', () => {
    const { sql, params } = buildReplaySqlQuery({ mapName: 'Fighting Spirit', gameType: 2 })
    expect(sql).toContain("r.map_name LIKE ? ESCAPE '\\'")
    expect(sql).toContain('r.game_type = ?')
    expect(params).toEqual(['%Fighting Spirit%', 2])
  })

  test('map name escapes LIKE wildcard characters in the substring', () => {
    const { params } = buildReplaySqlQuery({ mapName: '100%_off\\map' })
    expect(params).toEqual(['%100\\%\\_off\\\\map%'])
  })

  test('player name becomes an EXISTS subquery over replay_players', () => {
    const { sql, params } = buildReplaySqlQuery({ playerName: 'flash' })
    expect(sql).toContain(
      "EXISTS (SELECT 1 FROM replay_players p WHERE p.replay_id = r.id AND p.name LIKE ? ESCAPE '\\')",
    )
    expect(params).toEqual(['%flash%'])
  })

  test('player name escapes LIKE wildcard characters in the substring', () => {
    const { params } = buildReplaySqlQuery({ playerName: '100%_off\\player' })
    expect(params).toEqual(['%100\\%\\_off\\\\player%'])
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

  test('no sort defaults to newest-first', () => {
    expect(buildReplaySqlQuery({}).sql).toContain('ORDER BY r.game_time DESC')
  })

  test('LatestFirst orders by game_time DESC', () => {
    expect(buildReplaySqlQuery({ sort: GameSortOption.LatestFirst }).sql).toContain(
      'ORDER BY r.game_time DESC',
    )
  })

  test('OldestFirst orders by game_time ASC, nulls last', () => {
    expect(buildReplaySqlQuery({ sort: GameSortOption.OldestFirst }).sql).toContain(
      'ORDER BY r.game_time ASC NULLS LAST',
    )
  })

  test('ShortestFirst orders by duration_frames ASC (nulls last), then game_time DESC', () => {
    expect(buildReplaySqlQuery({ sort: GameSortOption.ShortestFirst }).sql).toContain(
      'ORDER BY r.duration_frames ASC NULLS LAST, r.game_time DESC',
    )
  })

  test('LongestFirst orders by duration_frames DESC, then game_time DESC', () => {
    expect(buildReplaySqlQuery({ sort: GameSortOption.LongestFirst }).sql).toContain(
      'ORDER BY r.duration_frames DESC, r.game_time DESC',
    )
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
