import { SbUserId } from '../../../common/users/sb-user-id'

/**
 * Server-only store for each lobby occupant's measured round-trip time (ms) to their chosen home
 * region, keyed by lobby name and user id. `rttMs` feeds the netcode v2 session-create latency
 * estimate and must never reach the wire-visible `Slot` — lobby diffs broadcast every slot's full
 * record to every member, and per-player rtt is not for peers' eyes. Kept as its own small class
 * (rather than inline bookkeeping on `LobbyApi`) so its lifecycle is unit-testable without the
 * websocket DI graph `LobbyApi` itself requires.
 */
export class LobbyPlayerRttStore {
  private byLobby = new Map<string, Map<SbUserId, number>>()

  /** Records a player's measured rtt for a lobby, overwriting any previous value for that user. */
  set(lobbyName: string, userId: SbUserId, rttMs: number): void {
    let byUser = this.byLobby.get(lobbyName)
    if (!byUser) {
      byUser = new Map()
      this.byLobby.set(lobbyName, byUser)
    }
    byUser.set(userId, rttMs)
  }

  /** A snapshot of every occupant's recorded rtt for a lobby; empty if none has been recorded. */
  getAll(lobbyName: string): ReadonlyMap<SbUserId, number> {
    return this.byLobby.get(lobbyName) ?? new Map()
  }

  /** Drops a single occupant's recorded rtt, e.g. when they leave, are kicked, or are banned. */
  deleteUser(lobbyName: string, userId: SbUserId): void {
    this.byLobby.get(lobbyName)?.delete(userId)
  }

  /** Drops every recorded rtt for a lobby, e.g. once it closes or its game has started. */
  deleteLobby(lobbyName: string): void {
    this.byLobby.delete(lobbyName)
  }
}
