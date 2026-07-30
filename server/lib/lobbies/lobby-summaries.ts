import { LobbySummaryJson } from '../../../common/lobbies/lobby-network'
import { SbLobbyId } from '../../../common/lobbies/sb-lobby-id'

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
