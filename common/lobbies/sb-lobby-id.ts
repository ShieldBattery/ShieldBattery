import { Tagged } from 'type-fest'

/**
 * A lobby's id, generated server-side at creation time as a pretty-encoded random UUID (see
 * `common/pretty-id.ts`). Lobbies are ephemeral and keep no separate "raw" id: this value is the
 * lobby's identity everywhere (registries, wire protocol, routes).
 */
export type SbLobbyId = Tagged<string, 'SbLobbyId'>

/**
 * Converts a lobby id string into a properly typed version. Alternative methods of retrieving an
 * SbLobbyId should be preferred, such as using a value retrieved from the server.
 */
export function makeSbLobbyId(id: string): SbLobbyId {
  return id as SbLobbyId
}
