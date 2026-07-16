import { ReplayLibraryEntry, ReplayLibraryPlayer } from '../../common/replays-library'
import { startOfLocalDay } from '../games/day-header'

/**
 * The way a replay's players are laid out for display:
 * - `teams`: two or more explicit teams (rendered one column per team).
 * - `oneVsOne`: a melee-style 1v1 (a single team of exactly two players), split into two columns.
 * - `flat`: everything else (e.g. a >2-player melee where teams can't be determined), rendered as a
 *   single flat list balanced across two columns.
 */
export type ReplayTeamKind = 'teams' | 'oneVsOne' | 'flat'

export interface ReplayTeamLayout {
  kind: ReplayTeamKind
  teams: ReplayLibraryPlayer[][]
}

/**
 * Splits a chunk of players into two balanced columns (the first column gets the extra player when
 * the count is odd), dropping any resulting empty column.
 */
function balanceIntoTwoColumns(players: ReplayLibraryPlayer[]): ReplayLibraryPlayer[][] {
  if (players.length === 0) {
    return []
  }
  const half = Math.ceil(players.length / 2)
  const columns = [players.slice(0, half), players.slice(half)]
  return columns.filter(c => c.length > 0)
}

/**
 * Groups a replay's players into the team layout used for display. Mirrors the split semantics the
 * replay index uses for filtering (see `app/replay-library/replay-queries.ts`), but keeps the full
 * player objects (and always produces something renderable, even for the ambiguous case):
 *
 * - 2+ non-empty teams: returned as-is (ordered by team number).
 * - exactly one team of exactly two players (a melee 1v1): split into two one-player teams.
 * - anything else: all players in a single flat list, balanced across two columns.
 */
export function getReplayDisplayTeams(
  players: ReadonlyArray<ReplayLibraryPlayer>,
): ReplayTeamLayout {
  const byTeam = new Map<number, ReplayLibraryPlayer[]>()
  for (const p of players) {
    const team = byTeam.get(p.team)
    if (team) {
      team.push(p)
    } else {
      byTeam.set(p.team, [p])
    }
  }

  const teams = Array.from(byTeam.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([, teamPlayers]) => teamPlayers)
    .filter(t => t.length > 0)

  if (teams.length >= 2) {
    return { kind: 'teams', teams }
  }
  if (teams.length === 1 && teams[0].length === 2) {
    return { kind: 'oneVsOne', teams: [[teams[0][0]], [teams[0][1]]] }
  }

  return { kind: 'flat', teams: balanceIntoTwoColumns(players.slice()) }
}

/** Whether a given layout should render "Team 1 / Team 2" labels (genuine team games only). */
export function shouldShowTeamLabels(layout: ReplayTeamLayout): boolean {
  return layout.kind === 'teams' && layout.teams.some(t => t.length > 1)
}

/** A day's worth of replays, identified by the local start-of-day timestamp. */
export interface ReplayDayGroup {
  /** The local start-of-day (midnight) for this group, as unix ms. Stable key for the group. */
  dayStartMs: number
  entries: ReplayLibraryEntry[]
}

/**
 * Groups replays into consecutive calendar-day buckets (by local time). Input is expected to be
 * ordered newest-first (as the replay query returns it); the output preserves that ordering, both
 * across groups and within each group.
 */
export function groupReplaysByDay(entries: ReadonlyArray<ReplayLibraryEntry>): ReplayDayGroup[] {
  const groups: ReplayDayGroup[] = []
  let current: ReplayDayGroup | undefined

  for (const entry of entries) {
    const dayStartMs = startOfLocalDay(entry.gameTime)
    if (!current || current.dayStartMs !== dayStartMs) {
      current = { dayStartMs, entries: [entry] }
      groups.push(current)
    } else {
      current.entries.push(entry)
    }
  }

  return groups
}
