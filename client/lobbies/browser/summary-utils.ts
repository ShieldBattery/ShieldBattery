import { ReadonlyDeep } from 'type-fest'
import { LobbySummaryJson } from '../../../common/lobbies/lobby-network'
import { SbUserId } from '../../../common/users/sb-user-id'

/** A lobby list entry as the browser reads it: rendered and derived from, never mutated. */
export type LobbySummary = ReadonlyDeep<LobbySummaryJson>

/** How many of a set of seats are taken, out of how many exist. */
export interface SlotCounts {
  taken: number
  total: number
}

/**
 * Counts the seats people actually play from: occupants (humans and computers alike) out of every
 * player slot the layout has, open and closed included. Observer seats are counted separately by
 * `observerCounts` — they're a different kind of spot, and folding them in would make a 4-player
 * map read as an 8-player one.
 */
export function playerSlotCounts(summary: LobbySummary): SlotCounts {
  let taken = 0
  let total = 0

  for (const team of summary.teams) {
    if (team.isObserver) {
      continue
    }

    for (const slot of team.slots) {
      total += 1
      if (slot.type === 'human' || slot.type === 'computer') {
        taken += 1
      }
    }
  }

  return { taken, total }
}

/** Counts the player slots someone could still sit down in. */
export function openPlayerSlotCount(summary: LobbySummary): number {
  let open = 0

  for (const team of summary.teams) {
    if (team.isObserver) {
      continue
    }

    for (const slot of team.slots) {
      if (slot.type === 'open') {
        open += 1
      }
    }
  }

  return open
}

/**
 * Returns the ids of every seated person in the lobby, players and observers alike, in the order
 * they sit.
 */
export function humanUserIds(summary: LobbySummary): SbUserId[] {
  const seen = new Set<SbUserId>()
  const userIds: SbUserId[] = []

  for (const team of summary.teams) {
    for (const slot of team.slots) {
      if (slot.type !== 'human' && slot.type !== 'observer') {
        continue
      }
      if (seen.has(slot.userId)) {
        continue
      }

      seen.add(slot.userId)
      userIds.push(slot.userId)
    }
  }

  return userIds
}

/** How many observer seats are filled, and how many are open for someone else to take. */
export function observerCounts(summary: LobbySummary): { taken: number; open: number } {
  let taken = 0
  let open = 0

  for (const team of summary.teams) {
    if (!team.isObserver) {
      continue
    }

    for (const slot of team.slots) {
      if (slot.type === 'observer') {
        taken += 1
      } else if (slot.type === 'open') {
        open += 1
      }
    }
  }

  return { taken, open }
}

/** Whether someone could join this lobby as an observer right now. */
export function hasOpenObserverSlot(summary: LobbySummary): boolean {
  return observerCounts(summary).open > 0
}

/** Whether the lobby has an observer team at all, open seats or not. */
export function hasObserverTeam(summary: LobbySummary): boolean {
  return summary.teams.some(team => team.isObserver)
}

/**
 * Returns the viewer's friends who are in this lobby, in the order they sit. `friends` is the
 * relationship state's friends map, keyed by the friend's user id.
 */
export function friendsInLobby(
  summary: LobbySummary,
  friends: ReadonlyMap<SbUserId, unknown>,
): SbUserId[] {
  return friends.size ? humanUserIds(summary).filter(userId => friends.has(userId)) : []
}

/** Everyone seated in the lobby: players and observers alike. */
export function occupantCount(summary: LobbySummary): number {
  return humanUserIds(summary).length
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
    players += occupantCount(summary)
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
      return playerSlotCounts(b).taken - playerSlotCounts(a).taken
    case LobbyBrowserSort.OpenSlots:
      return openPlayerSlotCount(b) - openPlayerSlotCount(a)
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
