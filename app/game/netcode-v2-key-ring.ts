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

interface HeldKeyPair {
  keyPair: NetcodeV2KeyPair
  /**
   * Whether a launched game has adopted this keypair. An adopted entry stays in the ring as a
   * requeue reservation rather than being removed: after a failed matchmaking load the server
   * requeues the player with the same pubkey (the queue entry survives; only its queue time
   * resets), so the next match's handoff — a *different* game id, which never carries the previous
   * game's keypair forward — echoes this pubkey again and must still resolve it here.
   */
  adopted: boolean
}

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
 * every push is a genuinely new entry, and the oldest is evicted once the ring exceeds capacity
 * (adopted or not: a requeue reservation eight joins old is no longer a plausible requeue).
 */
export class NetcodeV2KeyRing {
  // A Map preserves insertion order, so the oldest entry is always its first key.
  private keys = new Map<string, HeldKeyPair>()

  /** Adds a newly-generated keypair to the ring, evicting the oldest entry if it's now over capacity. */
  push(keyPair: NetcodeV2KeyPair): void {
    this.keys.set(keyPair.publicKey, { keyPair, adopted: false })
    if (this.keys.size > NETCODE_V2_KEY_RING_CAPACITY) {
      const oldestPublicKey = this.keys.keys().next().value!
      this.keys.delete(oldestPublicKey)
    }
  }

  /**
   * Selects the keypair a launching game should adopt, marks it adopted, and retires every entry
   * generated before it.
   *
   * With `clientPubkey` (the server echoing which pubkey it seated), the exact match is adopted —
   * including one a previous game already adopted, which is how a failed matchmaking load's
   * requeue resolves: the server reuses the queued pubkey for the next match, under a new game id
   * (see {@link HeldKeyPair.adopted}). An unknown pubkey fails as `unknownPubkey`.
   *
   * Without it (a server that predates the echo field), the sole ring entry — adopted or not — is
   * adopted: with exactly one keypair in existence, the server can only hold that one, whether as
   * a fresh join's key or as a requeue reservation. Anything beyond one entry is a genuine
   * ambiguity, adopted mix or not. In particular, an unadopted entry is NOT positive evidence the
   * server accepted it: the key is generated and pushed *before* the queue request is submitted,
   * and the server can reject that request (e.g. as a gameplay-activity conflict) without touching
   * the existing ticket — leaving an adopted reservation that is still the seated key alongside an
   * unadopted orphan the server never accepted. Any guess between them can pair a token minted for
   * one keypair with a different keypair's private key — the relay then rejects the
   * connection-binding challenge and the whole lobby fails to load, the exact failure the echo
   * exists to prevent — so it fails as `ambiguousWithoutEcho` and the caller surfaces an explicit
   * error instead.
   *
   * Adoption retires every entry generated before the adopted one: the server seated exactly one
   * pubkey for this game, so older entries belong to join attempts this launch superseded (their
   * server-side tickets are gone) and could only make a later echo-less selection ambiguous.
   * Entries generated *after* the adopted one are kept — they belong to a newer join the user may
   * already have in flight.
   */
  adoptFor(clientPubkey: string | undefined): NetcodeV2KeyAdoption {
    if (clientPubkey === undefined) {
      if (this.keys.size === 0) {
        return { failure: 'noKeysGenerated' }
      }
      if (this.keys.size === 1) {
        return { keys: this.adopt(this.keys.keys().next().value!) }
      }
      return { failure: 'ambiguousWithoutEcho' }
    }

    if (!this.keys.has(clientPubkey)) {
      return { failure: this.keys.size === 0 ? 'noKeysGenerated' : 'unknownPubkey' }
    }
    return { keys: this.adopt(clientPubkey) }
  }

  /**
   * Marks `publicKey`'s entry adopted and removes every entry generated before it (insertion
   * order). At most one adopted entry ever exists: adopting a newer key removes any older
   * reservation along with the rest of its superseded predecessors.
   */
  private adopt(publicKey: string): NetcodeV2KeyPair {
    for (const held of [...this.keys.keys()]) {
      if (held === publicKey) {
        break
      }
      this.keys.delete(held)
    }
    const entry = this.keys.get(publicKey)!
    entry.adopted = true
    return entry.keyPair
  }
}
