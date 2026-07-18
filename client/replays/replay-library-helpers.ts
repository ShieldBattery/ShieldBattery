import { assertUnreachable } from '../../common/assert-unreachable'
import { ReplayLibraryEntry, ReplayLibraryPlayer } from '../../common/replays-library'
import { SbUserId } from '../../common/users/sb-user-id'
import { startOfLocalDay } from '../games/day-header'
import { PlayerTeamsDisplayPlayer } from '../games/player-teams-display'

/** Which subset of the library the rail is currently pointed at, driven by the `view` URL param. */
export type LibraryView = { kind: 'all' } | { kind: 'starred' } | { kind: 'playlist'; id: number }

const PLAYLIST_VIEW_PREFIX = 'pl-'

/** Parses the `view` URL param into a `LibraryView`. Unrecognized/malformed values fall back to `all`. */
export function parseView(value: string): LibraryView {
  if (value === 'starred') {
    return { kind: 'starred' }
  }
  if (value.startsWith(PLAYLIST_VIEW_PREFIX)) {
    const id = Number.parseInt(value.slice(PLAYLIST_VIEW_PREFIX.length), 10)
    if (Number.isFinite(id)) {
      return { kind: 'playlist', id }
    }
  }
  return { kind: 'all' }
}

/** Encodes a `LibraryView` back into the `view` URL param (empty string for the default `all`). */
export function encodeView(view: LibraryView): string {
  switch (view.kind) {
    case 'all':
      return ''
    case 'starred':
      return 'starred'
    case 'playlist':
      return `${PLAYLIST_VIEW_PREFIX}${view.id}`
    default:
      return assertUnreachable(view)
  }
}

/**
 * True when `view` is a playlist and the user hasn't chosen an explicit sort (`sortParam` is the
 * raw, possibly-empty `sort` URL param). In that case results come back in the playlist's manual
 * order, which shouldn't be day-grouped like the date sorts are.
 */
export function isManualPlaylistOrder(view: LibraryView, sortParam: string): boolean {
  return view.kind === 'playlist' && !sortParam
}

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
 * Converts a display layout into `PlayerTeamsDisplay` props. For players whose `sbUserId` resolves
 * to an entry in `resolvedNames`, shows that (current) name instead of the raw in-replay one;
 * falls back to the in-replay name while unresolved or for non-SB replays.
 */
export function playersToDisplayTeams(
  layout: ReplayTeamLayout,
  computerLabel: string,
  resolvedNames?: ReadonlyMap<SbUserId, string>,
): PlayerTeamsDisplayPlayer[][] {
  return layout.teams.map(team =>
    team.map(player => ({
      race: player.race,
      isRandom: false,
      name: player.isComputer
        ? computerLabel
        : ((player.sbUserId !== undefined ? resolvedNames?.get(player.sbUserId) : undefined) ??
          player.name),
      nameColor: 'normal' as const,
    })),
  )
}

/** A stable, non-day `dayStartMs` key marking the trailing group of unreadable replays. */
const UNREADABLE_GROUP_KEY = -1

/** A day's worth of replays, identified by the local start-of-day timestamp. */
export interface ReplayDayGroup {
  /** The local start-of-day (midnight) for this group, as unix ms. Stable key for the group. */
  dayStartMs: number
  entries: ReplayLibraryEntry[]
  /** Whether this is the trailing group of parse-error replays, rather than a calendar day. */
  unreadable?: boolean
}

/**
 * Groups replays into consecutive calendar-day buckets (by local time), with parse-error entries
 * collected into a single trailing `unreadable` group instead of being bucketed by their (zeroed)
 * `gameTime`. Input is expected to be ordered newest-first with parse-error entries trailing (as the
 * replay query returns it); the output preserves that ordering, both across groups and within each
 * group.
 */
export function groupReplaysByDay(entries: ReadonlyArray<ReplayLibraryEntry>): ReplayDayGroup[] {
  const groups: ReplayDayGroup[] = []
  let current: ReplayDayGroup | undefined

  for (const entry of entries) {
    if (entry.parseError) {
      if (!current || !current.unreadable) {
        current = { dayStartMs: UNREADABLE_GROUP_KEY, entries: [entry], unreadable: true }
        groups.push(current)
      } else {
        current.entries.push(entry)
      }
      continue
    }

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
