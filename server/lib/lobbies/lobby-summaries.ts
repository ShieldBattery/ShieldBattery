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
 * The wsapi `LobbyApi` (`server/lib/wsapi/lobbies.ts`) owns the in-memory lobby registry and
 * registers itself here at construction time. Other code that needs to read a live lobby's summary
 * (HTTP endpoints, page-metadata resolvers) should call {@link getLobbySummary} instead of importing
 * the websocket API directly — this mirrors the client's `dispatch-registry` pattern. A future
 * `LobbyService` extraction (moving the registry out of the wsapi class) will replace this seam with
 * a real injectable dependency.
 */
export function setLobbySummaryGetter(getter: LobbySummaryGetter): void {
  summaryGetter = getter
}

/** Returns the summary for the lobby with the given id, or `undefined` if it doesn't exist. */
export function getLobbySummary(id: SbLobbyId): LobbySummaryJson | undefined {
  return summaryGetter?.(id)
}

/**
 * Resolves a route id to a live lobby's summary and its host user, or `undefined` if either can't
 * be resolved.
 *
 * A malformed id can never match a live lobby, so it's treated the same as "not found" rather than
 * being distinguished as an invalid-input case. Likewise, a summary whose host user can't be
 * resolved is also treated as "not found": a half result (a summary without its host) is worse than
 * none, so callers only ever see a complete pair or nothing.
 */
export async function getLiveLobbyWithHost(
  routeId: string | undefined,
): Promise<{ summary: LobbySummaryJson; host: SbUser } | undefined> {
  if (!routeId || !isPrettyId(routeId)) {
    return undefined
  }

  const summary = getLobbySummary(makeSbLobbyId(routeId))
  if (!summary) {
    return undefined
  }

  const [host] = await findUsersById([summary.host.id])
  return host ? { summary, host } : undefined
}
