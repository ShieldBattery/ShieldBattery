import { SbUserId } from '../../../common/users/sb-user-id'

/** A lobby occupant's netcode v2 session-create inputs, collected at create/join time. */
export interface LobbyPlayerNetworkInfo {
  /** The occupant's measured round-trip time (ms) to their chosen home region, if reported. */
  rttMs?: number
  /** base64 of the occupant's per-session netcode v2 public key, if reported. */
  netcodeV2Pubkey?: string
}

/**
 * Server-only store for each lobby occupant's netcode v2 session-create inputs — their measured
 * round-trip time (ms) to their chosen home region and their per-session public key — keyed by lobby
 * name and user id. These feed the netcode v2 session create (the latency estimate, and the token's
 * embedded pubkey) and must never reach the wire-visible `Slot`: lobby diffs broadcast every slot's
 * full record to every member, and neither a player's rtt nor their pubkey is for peers' eyes. Kept
 * as its own small class (rather than inline bookkeeping on `LobbyApi`) so its lifecycle is
 * unit-testable without the websocket DI graph `LobbyApi` itself requires.
 */
export class LobbyPlayerNetworkStore {
  private byLobby = new Map<string, Map<SbUserId, LobbyPlayerNetworkInfo>>()

  /** Records a player's network info for a lobby, overwriting any previous value for that user. */
  set(lobbyName: string, userId: SbUserId, info: LobbyPlayerNetworkInfo): void {
    let byUser = this.byLobby.get(lobbyName)
    if (!byUser) {
      byUser = new Map()
      this.byLobby.set(lobbyName, byUser)
    }
    byUser.set(userId, info)
  }

  /**
   * A snapshot of every occupant's recorded network info for a lobby; empty if none has been
   * recorded. Copied, not a live view: callers hold it across async game-load work, where a
   * concurrent leave/kick must not mutate what they read.
   */
  getAll(lobbyName: string): ReadonlyMap<SbUserId, LobbyPlayerNetworkInfo> {
    const byUser = this.byLobby.get(lobbyName)
    return byUser ? new Map(byUser) : new Map()
  }

  /** Drops a single occupant's recorded info, e.g. when they leave, are kicked, or are banned. */
  deleteUser(lobbyName: string, userId: SbUserId): void {
    this.byLobby.get(lobbyName)?.delete(userId)
  }

  /** Drops every recorded info for a lobby, e.g. once it closes or its game has started. */
  deleteLobby(lobbyName: string): void {
    this.byLobby.delete(lobbyName)
  }
}
