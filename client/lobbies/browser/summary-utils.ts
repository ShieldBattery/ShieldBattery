import { ReadonlyDeep } from 'type-fest'
import { LobbySummaryJson, LobbySummaryTeamJson } from '../../../common/lobbies/lobby-network'
import { SbUserId } from '../../../common/users/sb-user-id'

/** A lobby list entry as the browser reads it: rendered and derived from, never mutated. */
export type LobbySummary = ReadonlyDeep<LobbySummaryJson>

/** The slot layout of the previewed lobby, as the browser reads it. */
export type LobbyPreviewTeams = ReadonlyArray<ReadonlyDeep<LobbySummaryTeamJson>>

/**
 * Returns the viewer's friends who are in this lobby, in the order they sit. `friends` is the
 * relationship state's friends map, keyed by the friend's user id.
 */
export function friendsInLobby(
  summary: LobbySummary,
  friends: ReadonlyMap<SbUserId, unknown>,
): SbUserId[] {
  return friends.size ? summary.occupantIds.filter(userId => friends.has(userId)) : []
}

/** The platform-wide tally the browser's header reads out, over every listed lobby. */
export function lobbyListStats(summaries: Iterable<LobbySummary>): {
  lobbies: number
  players: number
} {
  let lobbies = 0
  let players = 0

  for (const summary of summaries) {
    lobbies += 1
    // Everyone seated, players and observers alike.
    players += summary.occupantIds.length
  }

  return { lobbies, players }
}

/** How the browser's list can be ordered. */
export enum LobbyBrowserSort {
  Newest = 'newest',
  MostPlayers = 'mostPlayers',
  OpenSlots = 'openSlots',
}

export const ALL_LOBBY_BROWSER_SORTS: ReadonlyArray<LobbyBrowserSort> =
  Object.values(LobbyBrowserSort)

function compareBySort(a: LobbySummary, b: LobbySummary, sort: LobbyBrowserSort): number {
  switch (sort) {
    case LobbyBrowserSort.Newest:
      return b.createdAt - a.createdAt
    case LobbyBrowserSort.MostPlayers:
      return b.playerSlots.taken - a.playerSlots.taken
    case LobbyBrowserSort.OpenSlots:
      return b.playerSlots.open - a.playerSlots.open
    default:
      return sort satisfies never
  }
}

/**
 * Orders two lobbies for `sort`, falling back to name and then id so the list holds a stable order
 * as summaries stream in and out.
 */
export function compareSummaries(a: LobbySummary, b: LobbySummary, sort: LobbyBrowserSort): number {
  const primary = compareBySort(a, b, sort)
  if (primary !== 0) {
    return primary
  }

  const byName = a.name.localeCompare(b.name)
  return byName !== 0 ? byName : a.id.localeCompare(b.id)
}

/**
 * Whether a lobby answers a search box's `query`, matched against its name, its map's name, and its
 * host's name. `hostName` is passed in because the browser resolves it from the user store, where
 * it may not have arrived yet — an unresolved host simply never matches.
 */
export function lobbyMatchesSearch(
  summary: LobbySummary,
  query: string,
  hostName: string | undefined,
): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) {
    return true
  }

  return (
    summary.name.toLowerCase().includes(needle) ||
    summary.map.name.toLowerCase().includes(needle) ||
    (hostName?.toLowerCase().includes(needle) ?? false)
  )
}
