import { NetcodeV2KeyPair } from './netcode-v2-keys'

/** How many recently-generated keypairs {@link NetcodeV2KeyRing} keeps before evicting the oldest. */
const NETCODE_V2_KEY_RING_CAPACITY = 8

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

  /** Looks up a still-held keypair by its exact public key, if the ring still has it. */
  get(publicKey: string): NetcodeV2KeyPair | undefined {
    return this.keys.get(publicKey)
  }

  /**
   * The ring's sole keypair, for a launch handoff that carries no public key to match against (a
   * server that predates the echo field). With exactly one keypair outstanding there is no
   * ambiguity: the server can only have seated that one. With several outstanding, any guess (the
   * most recent, say) can pair a token minted for one keypair with a different keypair's private
   * key — the relay then rejects the connection-binding challenge and the whole lobby fails to
   * load, the exact failure the pubkey echo exists to prevent — so this refuses instead and the
   * caller surfaces an explicit error.
   */
  onlyKey(): NetcodeV2KeyPair | undefined {
    if (this.keys.size !== 1) {
      return undefined
    }
    return this.keys.values().next().value
  }
}
