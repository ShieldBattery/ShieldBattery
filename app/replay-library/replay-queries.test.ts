import { describe, expect, test } from 'vitest'
import {
  decodeMatchup,
  GameDurationFilter,
  GameSortOption,
  getTeamSizeForFormat,
  makeEncodedMatchupString,
} from '../../common/games/game-filters'
import { expandMatchupFilter } from '../../common/games/matchups'
import { FEATURED_REPLAY_GAME_TYPES, SupportedReplayGameType } from '../../common/replays'
import { buildReplaySqlQuery, escapeLike } from './replay-queries'

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
    expect(sql).toBe(
      'SELECT r.* FROM replays r ORDER BY r.parse_error ASC, r.game_time DESC, r.id ASC',
    )
    expect(sql).not.toContain('WHERE')
    expect(params).toEqual([])
  })

  test('map name becomes a case-insensitive substring LIKE check', () => {
    const { sql, params } = buildReplaySqlQuery({ mapName: 'Fighting Spirit', gameType: 2 })
    expect(sql).toContain("r.map_name LIKE ? ESCAPE '\\'")
    expect(sql).toContain('r.game_type = ?')
    expect(params).toEqual(['%Fighting Spirit%', 2])
  })

  test('countSql reuses the WHERE clause and params, without an ORDER BY', () => {
    const { countSql, params } = buildReplaySqlQuery({ mapName: 'Fighting Spirit', gameType: 2 })
    expect(countSql).toBe(
      "SELECT COUNT(*) AS count FROM replays r WHERE r.map_name LIKE ? ESCAPE '\\' " +
        'AND r.game_type = ? AND r.parse_error = 0',
    )
    expect(countSql).not.toContain('ORDER BY')
    expect(params).toEqual(['%Fighting Spirit%', 2])
  })

  test('sql has no LIMIT/OFFSET applied', () => {
    const { sql } = buildReplaySqlQuery({ mapName: 'Fighting Spirit' })
    expect(sql).not.toContain('LIMIT')
    expect(sql).not.toContain('OFFSET')
  })

  test('gameType "others" becomes a NOT IN check against the featured game types', () => {
    const { sql, params } = buildReplaySqlQuery({ gameType: 'others' })
    const placeholders = FEATURED_REPLAY_GAME_TYPES.map(() => '?').join(', ')
    expect(sql).toContain(`r.game_type NOT IN (${placeholders})`)
    expect(params).toEqual([...FEATURED_REPLAY_GAME_TYPES])
  })

  test('gameType filter excludes parse-error rows (their game_type is zeroed, not "others")', () => {
    const { sql } = buildReplaySqlQuery({ gameType: 'others' })
    expect(sql).toContain('r.parse_error = 0')
  })

  test('numeric gameType matches exactly', () => {
    const { sql, params } = buildReplaySqlQuery({ gameType: SupportedReplayGameType.Melee })
    expect(sql).toContain('r.game_type = ?')
    expect(params).toEqual([SupportedReplayGameType.Melee])
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

  test('duration filter excludes parse-error rows (their duration_frames is zeroed)', () => {
    const { sql } = buildReplaySqlQuery({ duration: GameDurationFilter.Under10 })
    expect(sql).toContain('r.parse_error = 0')
  })

  test('no sort defaults to newest-first', () => {
    expect(buildReplaySqlQuery({}).sql).toContain(
      'ORDER BY r.parse_error ASC, r.game_time DESC, r.id ASC',
    )
  })

  test('LatestFirst orders by parse_error ASC, game_time DESC, then id ASC', () => {
    expect(buildReplaySqlQuery({ sort: GameSortOption.LatestFirst }).sql).toContain(
      'ORDER BY r.parse_error ASC, r.game_time DESC, r.id ASC',
    )
  })

  test('OldestFirst orders by parse_error ASC, game_time ASC, then id ASC', () => {
    expect(buildReplaySqlQuery({ sort: GameSortOption.OldestFirst }).sql).toContain(
      'ORDER BY r.parse_error ASC, r.game_time ASC, r.id ASC',
    )
  })

  test('ShortestFirst orders by parse_error ASC, duration_frames ASC, game_time DESC, then id ASC', () => {
    expect(buildReplaySqlQuery({ sort: GameSortOption.ShortestFirst }).sql).toContain(
      'ORDER BY r.parse_error ASC, r.duration_frames ASC, r.game_time DESC, r.id ASC',
    )
  })

  test('LongestFirst orders by parse_error ASC, duration_frames DESC, game_time DESC, then id ASC', () => {
    expect(buildReplaySqlQuery({ sort: GameSortOption.LongestFirst }).sql).toContain(
      'ORDER BY r.parse_error ASC, r.duration_frames DESC, r.game_time DESC, r.id ASC',
    )
  })
})

describe('app/replay-library/replay-queries/buildReplaySqlQuery format/matchup filters', () => {
  test('format alone filters by team size', () => {
    const { sql, params } = buildReplaySqlQuery({ format: '2v2' })
    expect(sql).toContain('r.team_size = ?')
    expect(params).toEqual([getTeamSizeForFormat('2v2')])
  })

  test('format with a concrete matchup adds an IN clause over the expanded matchup strings', () => {
    const matchup = makeEncodedMatchupString('p-z')
    const { sql, params } = buildReplaySqlQuery({ format: '1v1', matchup })
    const expanded = expandMatchupFilter(decodeMatchup('1v1', matchup)!)
    const placeholders = expanded.map(() => '?').join(', ')

    expect(sql).toContain(`r.matchup IN (${placeholders})`)
    expect(params).toEqual([getTeamSizeForFormat('1v1'), ...expanded])
  })

  test('wildcard-only matchup adds no matchup clause', () => {
    const { sql, params } = buildReplaySqlQuery({
      format: '1v1',
      matchup: makeEncodedMatchupString('_-_'),
    })
    expect(sql).not.toContain('r.matchup')
    expect(params).toEqual([getTeamSizeForFormat('1v1')])
  })

  test('matchup without format adds no clause', () => {
    const { sql, params } = buildReplaySqlQuery({ matchup: makeEncodedMatchupString('p-z') })
    expect(sql).not.toContain('r.team_size')
    expect(sql).not.toContain('r.matchup')
    expect(params).toEqual([])
  })
})

describe('app/replay-library/replay-queries/buildReplaySqlQuery bookmarked filter', () => {
  test('bookmarked adds a bookmarked_at IS NOT NULL clause', () => {
    const { sql, params } = buildReplaySqlQuery({ bookmarked: true })
    expect(sql).toContain('r.bookmarked_at IS NOT NULL')
    expect(params).toEqual([])
  })

  test('bookmarked alone does not exclude parse-error rows (curation, not a value filter)', () => {
    const { sql } = buildReplaySqlQuery({ bookmarked: true })
    expect(sql).not.toContain('r.parse_error = 0')
  })

  test('bookmarked combined with a value filter still excludes parse-error rows', () => {
    const { sql } = buildReplaySqlQuery({ bookmarked: true, mapName: 'Fighting Spirit' })
    expect(sql).toContain('r.parse_error = 0')
  })

  test('false is treated as "don\'t filter"', () => {
    const { sql } = buildReplaySqlQuery({ bookmarked: false })
    expect(sql).not.toContain('bookmarked_at')
  })
})

describe('app/replay-library/replay-queries/buildReplaySqlQuery playlist filter', () => {
  test('playlistId adds an INNER JOIN over playlist_entries in both sql and countSql', () => {
    const { sql, countSql, params } = buildReplaySqlQuery({ playlistId: 7 })
    const join = 'INNER JOIN playlist_entries pe ON pe.replay_id = r.id AND pe.playlist_id = ?'
    expect(sql).toContain(join)
    expect(countSql).toContain(join)
    expect(params).toEqual([7])
  })

  test('playlistId alone does not exclude parse-error rows (curation, not a value filter)', () => {
    const { sql } = buildReplaySqlQuery({ playlistId: 7 })
    expect(sql).not.toContain('r.parse_error = 0')
  })

  test('playlistId combined with a value filter still excludes parse-error rows, and the join param leads the value params', () => {
    const { sql, params } = buildReplaySqlQuery({ playlistId: 7, mapName: 'Fighting Spirit' })
    expect(sql).toContain('r.parse_error = 0')
    expect(params).toEqual([7, '%Fighting Spirit%'])
  })

  test("playlistId with no explicit sort orders by the playlist's manual position", () => {
    const { sql } = buildReplaySqlQuery({ playlistId: 7 })
    expect(sql).toContain('ORDER BY pe.position ASC, r.id ASC')
  })

  test('an explicit sort overrides the playlist manual order', () => {
    const { sql } = buildReplaySqlQuery({ playlistId: 7, sort: GameSortOption.OldestFirst })
    expect(sql).toContain('ORDER BY r.parse_error ASC, r.game_time ASC, r.id ASC')
    expect(sql).not.toContain('pe.position')
  })
})
