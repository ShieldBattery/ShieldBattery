import { RaceChar } from '../../common/races'
import { ReplayLibraryEntry, ReplayLibraryPlayer } from '../../common/replays-library'

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

/**
 * A short descriptor of the replay's matchup shown in the compact matchup column. Either a list of
 * per-side races (e.g. Terran vs Zerg, rendered as colored letters) or a plain text label (e.g.
 * `2v2`, `FFA`).
 */
export type ReplayMatchupBadge =
  | { kind: 'races'; races: RaceChar[] }
  | { kind: 'text'; text: string }

/** Derives the compact matchup badge for a replay's team layout. */
export function getReplayMatchupBadge(layout: ReplayTeamLayout): ReplayMatchupBadge {
  const { kind, teams } = layout

  if (kind === 'oneVsOne') {
    return { kind: 'races', races: [teams[0][0].race, teams[1][0].race] }
  }

  if (kind === 'teams') {
    if (teams.length === 2 && teams[0].length === 1 && teams[1].length === 1) {
      return { kind: 'races', races: [teams[0][0].race, teams[1][0].race] }
    }
    if (teams.length === 2) {
      return { kind: 'text', text: `${teams[0].length}v${teams[1].length}` }
    }
    return { kind: 'text', text: 'FFA' }
  }

  // Flat layout: a single lonely player shows just their race, otherwise treat as a free-for-all.
  const total = teams.reduce((sum, t) => sum + t.length, 0)
  if (total <= 1) {
    const only = teams[0]?.[0]
    return only ? { kind: 'races', races: [only.race] } : { kind: 'text', text: 'FFA' }
  }
  return { kind: 'text', text: 'FFA' }
}

/** Formats a byte count as a short human-readable size (e.g. `1.2 MB`, `840 KB`). */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`
  }
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  // Show one decimal place under 10, none above (e.g. `1.2 MB` but `24 MB`).
  const rounded = value >= 10 ? Math.round(value) : Math.round(value * 10) / 10
  return `${rounded} ${units[unitIndex]}`
}

/** A day's worth of replays, identified by the local start-of-day timestamp. */
export interface ReplayDayGroup {
  /** The local start-of-day (midnight) for this group, as unix ms. Stable key for the group. */
  dayStartMs: number
  entries: ReplayLibraryEntry[]
}

/** Returns the local start-of-day (midnight) timestamp, in unix ms, for a given instant. */
export function startOfLocalDay(ms: number): number {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/**
 * Returns the local start-of-day timestamps for today and yesterday (used to label day-group
 * headers). Kept out of component render bodies so the `Date.now()` read doesn't trip the
 * render-purity lint rule.
 */
export function getDayBoundaries(): { todayStartMs: number; yesterdayStartMs: number } {
  const todayStartMs = startOfLocalDay(Date.now())
  return { todayStartMs, yesterdayStartMs: startOfLocalDay(todayStartMs - 1) }
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
