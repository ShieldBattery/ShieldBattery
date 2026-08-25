import { NetcodeV2KeyPair } from './netcode-v2-keys'

/** How many recently-generated keypairs {@link NetcodeV2KeyRing} keeps before evicting the oldest. */
const NETCODE_V2_KEY_RING_CAPACITY = 8

/**
 * The outcome of {@link NetcodeV2KeyRing.adoptFor}: the adopted keypair, or why no keypair could
 * be safely selected. The failure reasons are distinct because they mean different things to a
 * user-facing error: `noKeysGenerated` and `unknownPubkey` indicate a flow bug (or a ring eviction
 * from an unreasonable number of joins), while `ambiguousWithoutEcho` is the deliberate refusal to
 * guess among several outstanding keypairs when the server didn't say which one it seated.
 */
export type NetcodeV2KeyAdoption =
  | { keys: NetcodeV2KeyPair }
  | { failure: 'noKeysGenerated' | 'unknownPubkey' | 'ambiguousWithoutEcho' }

/**
 * An insertion-ordered ring of recently-generated netcode v2 keypairs, keyed by public key.
 *
 * Every lobby join/create and matchmaking queue action generates a fresh keypair and submits its
 * public key to the server. If a player triggers more than one of these in a row (double-click, a
 * UI retry) before a game launches, several keypairs can be outstanding at once, and the server may
 * seat the player using any one of them (whichever join it happened to process). The ring holds
 * the last few so the app can look a keypair back up by the exact public key the server echoes
 * back in the launch handoff, rather than assuming it's always the most recently generated one.
 *
 * A repeat `push` of the same public key can't happen in practice (each call generates a fresh
 * Ed25519 keypair; a collision would require breaking Ed25519), so there's no dedup subtlety --
 * every push is a genuinely new entry, and the oldest is evicted once the ring exceeds capacity.
 */
export class NetcodeV2KeyRing {
  // A Map preserves insertion order, so the oldest entry is always its first key.
  private keys = new Map<string, NetcodeV2KeyPair>()

  /** Adds a newly-generated keypair to the ring, evicting the oldest entry if it's now over capacity. */
  push(keyPair: NetcodeV2KeyPair): void {
    this.keys.set(keyPair.publicKey, keyPair)
    if (this.keys.size > NETCODE_V2_KEY_RING_CAPACITY) {
      const oldestPublicKey = this.keys.keys().next().value!
      this.keys.delete(oldestPublicKey)
    }
  }

  /**
   * Selects the keypair a launching game should adopt and retires it (plus every older entry)
   * from the ring.
   *
   * With `clientPubkey` (the server echoing which pubkey it seated), the exact match is adopted;
   * an unknown pubkey fails as `unknownPubkey`. Without it (a server that predates the echo
   * field), the ring's sole keypair is adopted — with exactly one outstanding there is no
   * ambiguity, the server can only have seated that one. With several outstanding, any guess (the
   * most recent, say) can pair a token minted for one keypair with a different keypair's private
   * key — the relay then rejects the connection-binding challenge and the whole lobby fails to
   * load, the exact failure the echo exists to prevent — so that case fails as
   * `ambiguousWithoutEcho` and the caller surfaces an explicit error instead.
   *
   * Adoption retires the selected entry and everything generated before it: the server seated
   * exactly one pubkey for this game, so older entries belong to join attempts this launch
   * superseded and could only make a later echo-less selection ambiguous (breaking the old-server
   * fallback for every game after the first). Entries generated *after* the adopted one are kept —
   * they belong to a newer join the user may already have in flight. The adopted keypair itself
   * lives on with the game (a relaunch of the same game id reuses it without consulting the ring).
   */
  adoptFor(clientPubkey: string | undefined): NetcodeV2KeyAdoption {
    if (clientPubkey === undefined) {
      if (this.keys.size === 0) {
        return { failure: 'noKeysGenerated' }
      }
      if (this.keys.size > 1) {
        return { failure: 'ambiguousWithoutEcho' }
      }
      const only = this.keys.values().next().value!
      this.keys.clear()
      return { keys: only }
    }

    const keys = this.keys.get(clientPubkey)
    if (!keys) {
      return { failure: this.keys.size === 0 ? 'noKeysGenerated' : 'unknownPubkey' }
    }
    this.retireThrough(clientPubkey)
    return { keys }
  }

  /** Removes `publicKey`'s entry and every entry generated before it (insertion order). */
  private retireThrough(publicKey: string): void {
    for (const held of [...this.keys.keys()]) {
      this.keys.delete(held)
      if (held === publicKey) {
        break
      }
    }
  }
}
