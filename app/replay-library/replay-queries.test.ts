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
    expect(sql).toBe('SELECT r.* FROM replays r ORDER BY r.parse_error ASC, r.game_time DESC')
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
      "SELECT COUNT(*) AS count FROM replays r WHERE r.map_name LIKE ? ESCAPE '\\' AND r.game_type = ?",
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

  test('no sort defaults to newest-first', () => {
    expect(buildReplaySqlQuery({}).sql).toContain('ORDER BY r.parse_error ASC, r.game_time DESC')
  })

  test('LatestFirst orders by parse_error ASC, then game_time DESC', () => {
    expect(buildReplaySqlQuery({ sort: GameSortOption.LatestFirst }).sql).toContain(
      'ORDER BY r.parse_error ASC, r.game_time DESC',
    )
  })

  test('OldestFirst orders by parse_error ASC, then game_time ASC', () => {
    expect(buildReplaySqlQuery({ sort: GameSortOption.OldestFirst }).sql).toContain(
      'ORDER BY r.parse_error ASC, r.game_time ASC',
    )
  })

  test('ShortestFirst orders by parse_error ASC, duration_frames ASC, then game_time DESC', () => {
    expect(buildReplaySqlQuery({ sort: GameSortOption.ShortestFirst }).sql).toContain(
      'ORDER BY r.parse_error ASC, r.duration_frames ASC, r.game_time DESC',
    )
  })

  test('LongestFirst orders by parse_error ASC, duration_frames DESC, then game_time DESC', () => {
    expect(buildReplaySqlQuery({ sort: GameSortOption.LongestFirst }).sql).toContain(
      'ORDER BY r.parse_error ASC, r.duration_frames DESC, r.game_time DESC',
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
