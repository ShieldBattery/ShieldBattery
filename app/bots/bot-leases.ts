import { BotKey } from '../../common/bots/bot-library'

/**
 * The bots running games hold. Each lease belongs to the launch that took it, so ending or failing
 * one launch can never free bots another game is still using.
 */
export class BotLeases {
  private readonly leases = new Map<symbol, ReadonlySet<BotKey>>()

  keys(): Set<BotKey> {
    const keys = new Set<BotKey>()
    for (const lease of this.leases.values()) {
      for (const key of lease) {
        keys.add(key)
      }
    }
    return keys
  }

  has(key: BotKey): boolean {
    for (const lease of this.leases.values()) {
      if (lease.has(key)) {
        return true
      }
    }
    return false
  }

  /**
   * Takes every one of `keys` for a single launch, returning the lease's token. Throws without
   * taking any of them if one is already held by another game.
   */
  acquire(keys: Iterable<BotKey>): symbol {
    const wanted = new Set(keys)
    for (const key of wanted) {
      if (this.has(key)) {
        throw new Error('This bot is being used by a game right now')
      }
    }
    const lease = Symbol('bot lease')
    this.leases.set(lease, wanted)
    return lease
  }

  /** Frees a launch's bots. Returns whether the lease was still held. */
  release(lease: symbol): boolean {
    return this.leases.delete(lease)
  }
}
