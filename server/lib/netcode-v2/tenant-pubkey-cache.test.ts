import {
  KeyObject,
  generateKeyPairSync,
  sign as signEd25519,
  verify as verifyEd25519,
} from 'node:crypto'
import { describe, expect, test, vi } from 'vitest'
import { TenantPubkeyCache, parseTenantPublicKeyHex } from './tenant-pubkey-cache'

/** Raw 32-byte Ed25519 public key, hex-encoded — the wire format the coordinator returns. */
function rawPublicKeyHex(publicKey: KeyObject): string {
  return (publicKey.export({ type: 'spki', format: 'der' }) as Buffer).subarray(-32).toString('hex')
}

describe('netcode-v2/parseTenantPublicKeyHex', () => {
  test('returns undefined for a value that is not 64 hex characters', () => {
    expect(parseTenantPublicKeyHex('not-hex')).toBeUndefined()
    expect(parseTenantPublicKeyHex('')).toBeUndefined()
  })

  test('parses a valid hex key into a KeyObject that verifies the matching private key', () => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519')

    const parsed = parseTenantPublicKeyHex(rawPublicKeyHex(publicKey))
    expect(parsed).toBeDefined()

    const message = Buffer.from('hello')
    const signature = signEd25519(null, message, privateKey)
    expect(verifyEd25519(null, message, parsed!, signature)).toBe(true)
  })
})

describe('netcode-v2/TenantPubkeyCache', () => {
  test('fetches once and reuses the cached key on subsequent getKey calls', async () => {
    const { publicKey } = generateKeyPairSync('ed25519')
    const fetchPubkeyHex = vi.fn().mockResolvedValue(rawPublicKeyHex(publicKey))

    const cache = new TenantPubkeyCache(fetchPubkeyHex)
    const key1 = await cache.getKey()
    const key2 = await cache.getKey()

    expect(fetchPubkeyHex).toHaveBeenCalledTimes(1)
    expect(key1).toBeDefined()
    expect(key2).toBe(key1)
  })

  test('shares one in-flight fetch across concurrent getKey calls', async () => {
    const { publicKey } = generateKeyPairSync('ed25519')
    let resolveFetch: (hex: string) => void = () => {}
    const fetchPubkeyHex = vi.fn(
      () =>
        new Promise<string>(resolve => {
          resolveFetch = resolve
        }),
    )

    const cache = new TenantPubkeyCache(fetchPubkeyHex)
    const pending1 = cache.getKey()
    const pending2 = cache.getKey()
    resolveFetch(rawPublicKeyHex(publicKey))
    const [key1, key2] = await Promise.all([pending1, pending2])

    expect(fetchPubkeyHex).toHaveBeenCalledTimes(1)
    expect(key1).toBeDefined()
    expect(key2).toBe(key1)
  })

  test('returns undefined without throwing when the fetch rejects', async () => {
    const fetchPubkeyHex = vi.fn().mockRejectedValue(new Error('coordinator unreachable'))
    const cache = new TenantPubkeyCache(fetchPubkeyHex)

    await expect(cache.getKey()).resolves.toBeUndefined()
  })

  test('returns undefined without throwing when the fetched value is malformed', async () => {
    const fetchPubkeyHex = vi.fn().mockResolvedValue('not-hex')
    const cache = new TenantPubkeyCache(fetchPubkeyHex)

    await expect(cache.getKey()).resolves.toBeUndefined()
  })

  test('refetchAfterVerificationFailure fetches a fresh key, then rate-limits a second call', async () => {
    const first = generateKeyPairSync('ed25519')
    const second = generateKeyPairSync('ed25519')
    const fetchPubkeyHex = vi
      .fn()
      .mockResolvedValueOnce(rawPublicKeyHex(first.publicKey))
      .mockResolvedValueOnce(rawPublicKeyHex(second.publicKey))

    const cache = new TenantPubkeyCache(fetchPubkeyHex)
    await cache.getKey()
    expect(fetchPubkeyHex).toHaveBeenCalledTimes(1)

    const rotated = await cache.refetchAfterVerificationFailure()
    expect(fetchPubkeyHex).toHaveBeenCalledTimes(2)
    expect(rotated).toBeDefined()

    // Immediately calling again is well inside the cooldown — must not trigger another fetch.
    const rateLimited = await cache.refetchAfterVerificationFailure()
    expect(fetchPubkeyHex).toHaveBeenCalledTimes(2)
    expect(rateLimited).toBeUndefined()
  })
})
