import { SbLobbyId } from '../../../common/lobbies/sb-lobby-id'
import { SbUserId } from '../../../common/users/sb-user-id'

/** A lobby occupant's netcode v2 session-create inputs, collected at create/join time. */
export interface LobbyPlayerNetworkInfo {
  /** The occupant's measured round-trip time (ms) to their chosen home region, if reported. */
  rttMs?: number
  /**
   * Whether the occupant's chosen home region came from their manual server-region setting rather
   * than the auto (lowest-RTT) resolution, if reported. Recorded onto the game's netcode
   * diagnostics; never an input to placement.
   */
  regionManual?: boolean
  /** base64 of the occupant's per-session netcode v2 public key, if reported. */
  netcodeV2Pubkey?: string
}

/**
 * Server-only store for each lobby occupant's netcode v2 session-create inputs — their measured
 * round-trip time (ms) to their chosen home region, how that region was chosen, and their
 * per-session public key — keyed by lobby id and user id. These feed the netcode v2 session create
 * (the latency estimate, the game's netcode diagnostics, and the token's embedded pubkey) and must
 * never reach the wire-visible `Slot`: lobby diffs broadcast every slot's full record to every
 * member, and none of a player's rtt, region source, or pubkey is for peers' eyes. Kept
 * as its own small class (rather than inline bookkeeping on `LobbyService`) so its lifecycle is
 * unit-testable without the DI graph `LobbyService` itself requires.
 */
export class LobbyPlayerNetworkStore {
  private byLobby = new Map<SbLobbyId, Map<SbUserId, LobbyPlayerNetworkInfo>>()

  /** Records a player's network info for a lobby, overwriting any previous value for that user. */
  set(lobbyId: SbLobbyId, userId: SbUserId, info: LobbyPlayerNetworkInfo): void {
    let byUser = this.byLobby.get(lobbyId)
    if (!byUser) {
      byUser = new Map()
      this.byLobby.set(lobbyId, byUser)
    }
    byUser.set(userId, info)
  }

  /**
   * A snapshot of every occupant's recorded network info for a lobby; empty if none has been
   * recorded. Copied, not a live view: callers hold it across async game-load work, where a
   * concurrent leave/kick must not mutate what they read.
   */
  getAll(lobbyId: SbLobbyId): ReadonlyMap<SbUserId, LobbyPlayerNetworkInfo> {
    const byUser = this.byLobby.get(lobbyId)
    return byUser ? new Map(byUser) : new Map()
  }

  /** Drops a single occupant's recorded info, e.g. when they leave, are kicked, or are banned. */
  deleteUser(lobbyId: SbLobbyId, userId: SbUserId): void {
    this.byLobby.get(lobbyId)?.delete(userId)
  }

  /** Drops every recorded info for a lobby, e.g. once it closes or its game has started. */
  deleteLobby(lobbyId: SbLobbyId): void {
    this.byLobby.delete(lobbyId)
  }
}
