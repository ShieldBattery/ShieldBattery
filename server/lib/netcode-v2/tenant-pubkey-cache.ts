import { KeyObject, createPublicKey } from 'node:crypto'
import log from '../logging/logger'

const HEX_PUBKEY_PATTERN = /^[0-9a-f]{64}$/i

/** How long a verification failure against the cached key must hold off before re-fetching. */
const REFETCH_COOLDOWN_MS = 30 * 1000

/**
 * Parses a raw Ed25519 public key's hex form (64 hex chars) into a `KeyObject`, via a JWK
 * (`OKP`/`Ed25519`) construction — Node's `crypto` has no direct "raw Ed25519 public key" import,
 * and a JWK only needs the raw key re-encoded as base64url. Returns undefined (logging why) for a
 * malformed value.
 */
export function parseTenantPublicKeyHex(hex: string): KeyObject | undefined {
  if (!HEX_PUBKEY_PATTERN.test(hex)) {
    log.error('rp2 coordinator returned a malformed tenant pubkey (not 64 hex characters)')
    return undefined
  }

  const rawKey = Buffer.from(hex, 'hex')
  return createPublicKey({
    key: { kty: 'OKP', crv: 'Ed25519', x: rawKey.toString('base64url') },
    format: 'jwk',
  })
}

/**
 * In-memory cache for a rally-point2 tenant's Ed25519 public key, fetched lazily from the
 * coordinator on first use. Deliberately generic over *how* the key is fetched (constructor takes
 * the fetch function) so it has no knowledge of HTTP/coordinator specifics and is trivial to unit
 * test.
 */
export class TenantPubkeyCache {
  private cachedKey: KeyObject | undefined
  private inFlight: Promise<KeyObject | undefined> | undefined
  private lastRefetchAttemptMs = 0

  constructor(private fetchPubkeyHex: () => Promise<string>) {}

  /**
   * Returns the cached key, fetching it first if nothing has been cached yet. Concurrent callers
   * during that first fetch share the one in-flight request rather than each triggering their own.
   */
  async getKey(): Promise<KeyObject | undefined> {
    if (this.cachedKey) {
      return this.cachedKey
    }
    return this.fetchAndCache()
  }

  /**
   * Re-fetches the key after a signature failed to verify against the currently-cached one — this
   * is what lets a coordinator-side key rotation take effect without an app server restart.
   * Rate-limited (at most once per 30s) so a flood of garbage signatures can't turn into a flood of
   * requests to the coordinator: a call inside the cooldown returns undefined without fetching,
   * meaning "still just the (already known to be failing) cached key."
   */
  async refetchAfterVerificationFailure(): Promise<KeyObject | undefined> {
    const now = Date.now()
    if (now - this.lastRefetchAttemptMs < REFETCH_COOLDOWN_MS) {
      return undefined
    }
    this.lastRefetchAttemptMs = now

    return this.fetchAndCache()
  }

  private fetchAndCache(): Promise<KeyObject | undefined> {
    if (!this.inFlight) {
      this.inFlight = this.doFetch().finally(() => {
        this.inFlight = undefined
      })
    }
    return this.inFlight
  }

  private async doFetch(): Promise<KeyObject | undefined> {
    try {
      const hex = await this.fetchPubkeyHex()
      const key = parseTenantPublicKeyHex(hex)
      if (key) {
        this.cachedKey = key
      }
      return key
    } catch (err) {
      log.warn({ err }, 'failed to fetch rp2 tenant pubkey from coordinator')
      return undefined
    }
  }
}
