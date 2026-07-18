import {
  decodeMatchup,
  GameDurationFilter,
  GameFormat,
  GameSortOption,
  getTeamSizeForFormat,
  MatchupFilter,
} from '../../common/games/game-filters'
import { computeMatchupString, expandMatchupFilter } from '../../common/games/matchups'
import { RaceChar } from '../../common/races'
import { FEATURED_REPLAY_GAME_TYPES } from '../../common/replays'
import { ReplayLibraryFilters, ReplayLibraryPlayer } from '../../common/replays-library'

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
  sql: string
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
 * Maps a {@link GameSortOption} (defaulting to newest-first) to the `ORDER BY` clause body used in
 * the replay query. Parse-error rows store zeroed `game_time`/`duration_frames` (see
 * `makeParseErrorRecord`), so every branch leads with `r.parse_error ASC` to pin them after readable
 * replays explicitly, rather than leaving them wherever zero happens to sort.
 */
function buildOrderByClause(sort: GameSortOption): string {
  switch (sort) {
    case GameSortOption.LatestFirst:
      return 'r.parse_error ASC, r.game_time DESC'
    case GameSortOption.OldestFirst:
      return 'r.parse_error ASC, r.game_time ASC'
    case GameSortOption.ShortestFirst:
      return 'r.parse_error ASC, r.duration_frames ASC, r.game_time DESC'
    case GameSortOption.LongestFirst:
      return 'r.parse_error ASC, r.duration_frames DESC, r.game_time DESC'
    default:
      return sort satisfies never
  }
}

/**
 * Builds the SQL statement for the cheap, row-level part of a replay query (map name, player name,
 * game type, duration bucket). Format and matchup filters are applied in JS afterwards via
 * `replayPassesTeamFilters`, since they require the per-player team layout. Results are ordered per
 * `filters.sort` (defaulting to newest-first).
 */
export function buildReplaySqlQuery(filters: ReplayLibraryFilters): ReplaySqlQuery {
  const whereClauses: string[] = []
  const params: Array<string | number> = []

  if (filters.mapName !== undefined) {
    whereClauses.push("r.map_name LIKE ? ESCAPE '\\'")
    params.push(`%${escapeLike(filters.mapName)}%`)
  }

  if (filters.playerName !== undefined) {
    whereClauses.push(
      "EXISTS (SELECT 1 FROM replay_players p WHERE p.replay_id = r.id AND p.name LIKE ? ESCAPE '\\')",
    )
    params.push(`%${escapeLike(filters.playerName)}%`)
  }

  if (filters.gameType === 'others') {
    const placeholders = FEATURED_REPLAY_GAME_TYPES.map(() => '?').join(', ')
    whereClauses.push(`r.game_type NOT IN (${placeholders})`)
    params.push(...FEATURED_REPLAY_GAME_TYPES)
  } else if (filters.gameType !== undefined) {
    whereClauses.push('r.game_type = ?')
    params.push(filters.gameType)
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
  }

  const where = whereClauses.length > 0 ? ` WHERE ${whereClauses.join(' AND ')}` : ''
  const orderBy = buildOrderByClause(filters.sort ?? GameSortOption.LatestFirst)
  const sql = `SELECT r.* FROM replays r${where} ORDER BY ${orderBy}`

  return { sql, params }
}

/**
 * Groups a replay's players into teams (arrays of races), mirroring the server's `getTeamsFromConfig`
 * semantics so format/matchup filtering behaves consistently:
 *
 * - 2+ non-empty teams: returned as-is
 * - exactly 1 team of exactly 2 players (e.g. a melee 1v1): split into two 1-player teams
 * - anything else (e.g. a >2-player melee where teams can't be determined): `null`
 */
export function getReplayTeamRaces(
  players: ReadonlyArray<ReplayLibraryPlayer>,
): RaceChar[][] | null {
  const byTeam = new Map<number, RaceChar[]>()
  for (const p of players) {
    const races = byTeam.get(p.team)
    if (races) {
      races.push(p.race)
    } else {
      byTeam.set(p.team, [p.race])
    }
  }

  const teams = Array.from(byTeam.values()).filter(t => t.length > 0)
  if (teams.length >= 2) {
    return teams
  }
  if (teams.length === 1) {
    if (teams[0].length === 2) {
      return [[teams[0][0]], [teams[0][1]]]
    }
    return null
  }
  return null
}

/** Returns true if the replay has exactly two teams, each of the format's team size. */
export function replayMatchesFormat(
  players: ReadonlyArray<ReplayLibraryPlayer>,
  format: GameFormat,
): boolean {
  const teams = getReplayTeamRaces(players)
  if (!teams) {
    return false
  }
  const teamSize = getTeamSizeForFormat(format)
  return teams.length === 2 && teams.every(t => t.length === teamSize)
}

/**
 * Returns true if the replay's canonical matchup is one of those the (wildcard-expanded) filter
 * allows. Team-order-agnostic, matching the server's `assigned_matchup = ANY(...)` behavior.
 */
export function replayMatchesMatchup(
  players: ReadonlyArray<ReplayLibraryPlayer>,
  matchup: MatchupFilter,
): boolean {
  const teams = getReplayTeamRaces(players)
  if (!teams) {
    return false
  }
  const matchupStr = computeMatchupString(teams)
  if (!matchupStr) {
    return false
  }
  return expandMatchupFilter(matchup).includes(matchupStr)
}

/**
 * Evaluates the format + matchup filters against a replay's players. Mirrors the server's
 * match-history semantics: the format filter constrains the team shape, and the matchup filter is
 * only applied when it constrains at least one race (a fully-wildcard matchup is a no-op). Replays
 * with no format filter always pass.
 */
export function replayPassesTeamFilters(
  players: ReadonlyArray<ReplayLibraryPlayer>,
  filters: Pick<ReplayLibraryFilters, 'format' | 'matchup'>,
): boolean {
  if (!filters.format) {
    return true
  }
  if (!replayMatchesFormat(players, filters.format)) {
    return false
  }

  const matchup = filters.matchup ? decodeMatchup(filters.format, filters.matchup) : undefined
  if (!matchup) {
    return true
  }

  const hasNonWildcard = [...matchup.team1, ...matchup.team2].some(r => r !== undefined)
  if (!hasNonWildcard) {
    return true
  }

  return replayMatchesMatchup(players, matchup)
}
