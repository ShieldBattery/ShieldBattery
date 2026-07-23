import {
  decodeMatchup,
  GameDurationFilter,
  GameSortOption,
  getTeamSizeForFormat,
} from '../../common/games/game-filters'
import { expandMatchupFilter } from '../../common/games/matchups'
import { FEATURED_REPLAY_GAME_TYPES } from '../../common/replays'
import { ReplayLibraryFilters } from '../../common/replays-library'

/**
 * Frames per second used to convert replay durations to real time. This matches the conversion the
 * rest of the codebase uses for replays (see `replay-info-display`): `durationFrames * 1000 / 24`.
 */
const REPLAY_FRAMES_PER_SECOND = 24

function durationMsToFrames(ms: number): number {
  return Math.round((ms * REPLAY_FRAMES_PER_SECOND) / 1000)
}

// Duration bucket boundaries in frames, mirroring the server's 10/20/30-minute match-history buckets.
const DURATION_10_MIN_FRAMES = durationMsToFrames(10 * 60 * 1000)
const DURATION_20_MIN_FRAMES = durationMsToFrames(20 * 60 * 1000)
const DURATION_30_MIN_FRAMES = durationMsToFrames(30 * 60 * 1000)

/** A parameterized SQL statement (with `?` placeholders). */
export interface ReplaySqlQuery {
  /** The full ordered select, without any `LIMIT`/`OFFSET` (callers append their own paging). */
  sql: string
  /** A `COUNT(*)` query sharing `sql`'s `WHERE` clause and `params`, with no `ORDER BY`. */
  countSql: string
  params: Array<string | number>
}

/**
 * Escapes `\`, `%`, and `_` in `value` so it can be safely embedded as a substring inside a
 * `LIKE ... ESCAPE '\'` pattern (i.e. `%${escapeLike(value)}%`).
 */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, ch => `\\${ch}`)
}

/**
 * Maps `filters` to the `ORDER BY` clause body used in the replay query. Parse-error rows store
 * zeroed `game_time`/`duration_frames` (see `makeParseErrorRecord`), so every sort branch leads
 * with `r.parse_error ASC` to pin them after readable replays explicitly, rather than leaving
 * them wherever zero happens to sort. The playlist manual order is the exception: it follows the
 * user's explicit positions alone.
 *
 * When `filters.playlistId` is set and no explicit `sort` was requested, results follow the
 * playlist's own manual ordering (`pe.position`) instead of the usual sort branches; an explicit
 * `sort` always overrides that.
 *
 * Every sort branch also ends with `r.id ASC` as a final tiebreaker: rows commonly tie on
 * `game_time` (e.g. a same-game autoreplay and manual save share the seed-derived timestamp), and
 * without a deterministic tiebreaker, paginated `LIMIT`/`OFFSET` windows can duplicate or skip rows
 * across chunks when ties are ordered differently between queries. It's `ASC` specifically (not
 * `DESC`) because SQLite indexes implicitly append the rowid in ascending order, so `game_time
 * DESC, id ASC` still lets the `(parse_error, game_time DESC)` index fully serve the default sort
 * without an extra sort step.
 */
function buildOrderByClause(filters: Pick<ReplayLibraryFilters, 'sort' | 'playlistId'>): string {
  if (filters.playlistId !== undefined && filters.sort === undefined) {
    // Purely position-ordered, with no parse-error pinning: the user's explicit placement governs
    // even for unreadable rows, and the client's move up/down maps a loaded list index to an
    // absolute playlist position, which requires result order to be exactly position order.
    return 'pe.position ASC, r.id ASC'
  }

  const sort = filters.sort ?? GameSortOption.LatestFirst
  switch (sort) {
    case GameSortOption.LatestFirst:
      return 'r.parse_error ASC, r.game_time DESC, r.id ASC'
    case GameSortOption.OldestFirst:
      return 'r.parse_error ASC, r.game_time ASC, r.id ASC'
    case GameSortOption.ShortestFirst:
      return 'r.parse_error ASC, r.duration_frames ASC, r.game_time DESC, r.id ASC'
    case GameSortOption.LongestFirst:
      return 'r.parse_error ASC, r.duration_frames DESC, r.game_time DESC, r.id ASC'
    default:
      return sort satisfies never
  }
}

/**
 * Builds the SQL statements for a replay query, covering every filter (map name, player name, game
 * type, duration bucket, format, matchup, bookmarked, playlist membership) — nothing is filtered in JS
 * afterwards. Format/matchup matching reads the `team_size`/`matchup` columns computed once at parse
 * time (see `mapReplayHeaderToRecord`). `sql` is ordered per `filters.sort` (defaulting to
 * newest-first, or the playlist's manual order when `filters.playlistId` is set with no explicit
 * `sort`) and has no paging applied; `countSql` reuses the same joins/`WHERE` clause and `params` to
 * total the matches, without an `ORDER BY`.
 */
export function buildReplaySqlQuery(filters: ReplayLibraryFilters): ReplaySqlQuery {
  const whereClauses: string[] = []
  const params: Array<string | number> = []
  // Tracks whether any value-constraining filter (as opposed to a curation filter like
  // bookmarked/playlist membership) is active, to decide whether to exclude parse-error rows below.
  let hasValueFilter = false

  let joinClause = ''
  if (filters.playlistId !== undefined) {
    joinClause = ' INNER JOIN playlist_entries pe ON pe.replay_id = r.id AND pe.playlist_id = ?'
    params.push(filters.playlistId)
  }

  if (filters.mapName !== undefined) {
    whereClauses.push("r.map_name LIKE ? ESCAPE '\\'")
    params.push(`%${escapeLike(filters.mapName)}%`)
    hasValueFilter = true
  }

  if (filters.playerName !== undefined) {
    whereClauses.push(
      "EXISTS (SELECT 1 FROM replay_players p WHERE p.replay_id = r.id AND p.name LIKE ? ESCAPE '\\')",
    )
    params.push(`%${escapeLike(filters.playerName)}%`)
    hasValueFilter = true
  }

  if (filters.gameType === 'others') {
    const placeholders = FEATURED_REPLAY_GAME_TYPES.map(() => '?').join(', ')
    whereClauses.push(`r.game_type NOT IN (${placeholders})`)
    params.push(...FEATURED_REPLAY_GAME_TYPES)
    hasValueFilter = true
  } else if (filters.gameType !== undefined) {
    whereClauses.push('r.game_type = ?')
    params.push(filters.gameType)
    hasValueFilter = true
  }

  if (filters.duration !== undefined && filters.duration !== GameDurationFilter.All) {
    switch (filters.duration) {
      case GameDurationFilter.Under10:
        whereClauses.push('r.duration_frames < ?')
        params.push(DURATION_10_MIN_FRAMES)
        break
      case GameDurationFilter.From10To20:
        whereClauses.push('r.duration_frames >= ? AND r.duration_frames < ?')
        params.push(DURATION_10_MIN_FRAMES, DURATION_20_MIN_FRAMES)
        break
      case GameDurationFilter.From20To30:
        whereClauses.push('r.duration_frames >= ? AND r.duration_frames < ?')
        params.push(DURATION_20_MIN_FRAMES, DURATION_30_MIN_FRAMES)
        break
      case GameDurationFilter.Over30:
        whereClauses.push('r.duration_frames >= ?')
        params.push(DURATION_30_MIN_FRAMES)
        break
      default:
        filters.duration satisfies never
    }
    hasValueFilter = true
  }

  if (filters.gameTimeFrom !== undefined) {
    whereClauses.push('r.game_time >= ?')
    params.push(filters.gameTimeFrom)
    hasValueFilter = true
  }

  if (filters.gameTimeTo !== undefined) {
    whereClauses.push('r.game_time <= ?')
    params.push(filters.gameTimeTo)
    hasValueFilter = true
  }

  if (filters.format !== undefined) {
    whereClauses.push('r.team_size = ?')
    params.push(getTeamSizeForFormat(filters.format))
    hasValueFilter = true

    // Matchup is only meaningful alongside a format (it decodes against the format's team size),
    // and a fully-wildcard matchup constrains nothing, so it's a no-op.
    const decoded = filters.matchup ? decodeMatchup(filters.format, filters.matchup) : undefined
    const hasNonWildcard = decoded
      ? [...decoded.team1, ...decoded.team2].some(r => r !== undefined)
      : false
    if (decoded && hasNonWildcard) {
      const matchupStrings = expandMatchupFilter(decoded)
      const placeholders = matchupStrings.map(() => '?').join(', ')
      whereClauses.push(`r.matchup IN (${placeholders})`)
      params.push(...matchupStrings)
    }
  }

  if (filters.bookmarked) {
    whereClauses.push('r.bookmarked_at IS NOT NULL')
  }

  // Parse-error rows store zeroed values (see `makeParseErrorRecord`), so an active filter's match
  // against them would be against garbage rather than a real value. Filters constrain known values,
  // so a parse-error row's unknown values must never satisfy one; excluding them here only when a
  // value filter is active leaves the unfiltered view showing them (pinned last by the ORDER BY
  // above). Bookmarked/playlist membership is user curation rather than a value match, so it must not
  // trigger this exclusion — a bookmarked-but-unreadable replay still belongs in the Bookmarked view.
  if (hasValueFilter) {
    whereClauses.push('r.parse_error = 0')
  }

  const where = whereClauses.length > 0 ? ` WHERE ${whereClauses.join(' AND ')}` : ''
  const orderBy = buildOrderByClause(filters)
  const sql = `SELECT r.* FROM replays r${joinClause}${where} ORDER BY ${orderBy}`
  const countSql = `SELECT COUNT(*) AS count FROM replays r${joinClause}${where}`

  return { sql, countSql, params }
}
