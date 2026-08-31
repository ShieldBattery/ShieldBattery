import { LobbySummaryJson } from '../../../common/lobbies/lobby-network'
import { makeSbLobbyId, SbLobbyId } from '../../../common/lobbies/sb-lobby-id'
import { isPrettyId } from '../../../common/pretty-id'
import { SbUser } from '../../../common/users/sb-user'
import { findUsersById } from '../users/user-model'

/** Looks up the live summary for a lobby by id, or `undefined` if no such lobby currently exists. */
export type LobbySummaryGetter = (id: SbLobbyId) => LobbySummaryJson | undefined

let summaryGetter: LobbySummaryGetter | undefined

/**
 * Registers the function used to resolve a lobby's summary by id.
 *
 * `LobbyService` (`server/lib/lobbies/lobby-service.ts`) owns the in-memory lobby registry and
 * registers itself here at construction time. Other code that needs to read a live lobby's summary
 * (HTTP endpoints, page-metadata resolvers) should call {@link getLobbySummary} instead of depending
 * on the service directly, which keeps those read-only paths off the lobby dependency graph — this
 * mirrors the client's `dispatch-registry` pattern.
 */
export function setLobbySummaryGetter(getter: LobbySummaryGetter): void {
  summaryGetter = getter
}

/** Returns the summary for the lobby with the given id, or `undefined` if it doesn't exist. */
export function getLobbySummary(id: SbLobbyId): LobbySummaryJson | undefined {
  return summaryGetter?.(id)
}

/** Looks up a lobby's current join code by id, or `undefined` if it has none. */
export type LobbyJoinCodeGetter = (id: SbLobbyId) => string | undefined

let joinCodeGetter: LobbyJoinCodeGetter | undefined

/**
 * Registers the function used to resolve a lobby's join code by id, mirroring
 * {@link setLobbySummaryGetter}.
 */
export function setLobbyJoinCodeGetter(getter: LobbyJoinCodeGetter): void {
  joinCodeGetter = getter
}

/** Returns the normalized join code for the given id, or `undefined` if it doesn't exist. */
export function getLobbyJoinCode(id: SbLobbyId): string | undefined {
  return joinCodeGetter?.(id)
}

/** Resolves a normalized join code to the live lobby id it currently belongs to. */
export type LobbyIdByJoinCodeGetter = (normalizedCode: string) => SbLobbyId | undefined

let lobbyIdByJoinCodeGetter: LobbyIdByJoinCodeGetter | undefined

/**
 * Registers the function used to resolve a normalized join code to its lobby id, mirroring
 * {@link setLobbySummaryGetter}.
 */
export function setLobbyIdByJoinCodeGetter(getter: LobbyIdByJoinCodeGetter): void {
  lobbyIdByJoinCodeGetter = getter
}

/** Returns the lobby id currently registered for `normalizedCode`, or `undefined`. */
export function getLobbyIdByJoinCode(normalizedCode: string): SbLobbyId | undefined {
  return lobbyIdByJoinCodeGetter?.(normalizedCode)
}

/** The result of resolving a live lobby by id or join code: its summary, host, and current code. */
export interface LiveLobbyWithHost {
  summary: LobbySummaryJson
  host: SbUser
  /** The lobby's current normalized join code, or `undefined` if it has none. */
  joinCode?: string
}

/**
 * Resolves a lobby id already known to be well-formed to its live summary, host user, and current
 * join code, or `undefined` if the lobby doesn't exist or its host user can't be resolved.
 *
 * A summary whose host user can't be resolved is treated as "not found": a half result (a summary
 * without its host) is worse than none, so callers only ever see a complete result or nothing.
 */
async function getLiveLobbyWithHostById(id: SbLobbyId): Promise<LiveLobbyWithHost | undefined> {
  const summary = getLobbySummary(id)
  if (!summary) {
    return undefined
  }

  const [host] = await findUsersById([summary.host.id])
  return host ? { summary, host, joinCode: getLobbyJoinCode(id) } : undefined
}

/**
 * Resolves a route id to a live lobby's summary, host user, and current join code, or `undefined`
 * if either the summary or host can't be resolved.
 *
 * A malformed id can never match a live lobby, so it's treated the same as "not found" rather than
 * being distinguished as an invalid-input case.
 */
export async function getLiveLobbyWithHost(
  routeId: string | undefined,
): Promise<LiveLobbyWithHost | undefined> {
  if (!routeId || !isPrettyId(routeId)) {
    return undefined
  }

  return getLiveLobbyWithHostById(makeSbLobbyId(routeId))
}

/**
 * Resolves a normalized join code to the live lobby it currently belongs to, in the same shape as
 * {@link getLiveLobbyWithHost}, or `undefined` if the code doesn't currently resolve to a live
 * lobby with a resolvable host.
 */
export async function getLiveLobbyWithHostByJoinCode(
  normalizedCode: string,
): Promise<LiveLobbyWithHost | undefined> {
  const id = getLobbyIdByJoinCode(normalizedCode)
  if (!id) {
    return undefined
  }

  return getLiveLobbyWithHostById(id)
}
