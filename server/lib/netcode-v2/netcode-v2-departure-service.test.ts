import { KeyObject, generateKeyPairSync, sign as signEd25519 } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { NetcodeV2DepartureNotification } from '../../../common/games/netcode-v2'
import { asMockedFunction } from '../../../common/testing/mocks'
import { makeSbUserId } from '../../../common/users/sb-user-id'
import { recordUserDeparture } from '../models/games-users'
import {
  checkDepartureWebhookAuth,
  recordDepartureNotification,
} from './netcode-v2-departure-service'
import { TenantPubkeyCache } from './tenant-pubkey-cache'

vi.mock('../models/games-users', () => ({
  recordUserDeparture: vi.fn(),
}))

const GAME_ID = '11111111-2222-4333-8444-555555555555'

/** Raw 32-byte Ed25519 public key, hex-encoded — the wire format the coordinator returns. */
function rawPublicKeyHex(publicKey: KeyObject): string {
  return (publicKey.export({ type: 'spki', format: 'der' }) as Buffer).subarray(-32).toString('hex')
}

/** Signs a departures-webhook request exactly as the production verification expects. */
function signWebhookRequest(privateKey: KeyObject, timestamp: string, rawBody: Buffer): string {
  const message = Buffer.concat([Buffer.from(`rp2-webhook-v1:${timestamp}:`, 'utf8'), rawBody])
  return signEd25519(null, message, privateKey).toString('base64')
}

function makeNotification(
  overrides: Partial<NetcodeV2DepartureNotification> = {},
): NetcodeV2DepartureNotification {
  return {
    tenant: 'sb-dev',
    session: 1,
    externalId: GAME_ID,
    slot: 0,
    externalRef: '42',
    kind: 'left',
    reason: 3,
    leaveSeq: 1,
    ...overrides,
  }
}

describe('netcode-v2/checkDepartureWebhookAuth', () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const pubkeyHex = rawPublicKeyHex(publicKey)
  const rawBody = Buffer.from('{"tenant":"sb-dev"}', 'utf8')

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  /** Stubs netcode v2 as configured (coordinator URL + tenant), as `loadConfigFromEnv` expects. */
  function configureNetcodeV2() {
    vi.stubEnv('SB_RP2_COORDINATOR_URL', 'http://coordinator.example')
    vi.stubEnv('SB_RP2_TENANT', 'sb-dev')
  }

  test('returns 404 when netcode v2 is not configured, regardless of the headers', async () => {
    vi.stubEnv('SB_RP2_COORDINATOR_URL', undefined)
    const cache = new TenantPubkeyCache(vi.fn())

    const timestamp = String(Date.now())
    const signature = signWebhookRequest(privateKey, timestamp, rawBody)

    expect(await checkDepartureWebhookAuth(timestamp, signature, rawBody, cache)).toBe(404)
    expect(await checkDepartureWebhookAuth('', '', rawBody, cache)).toBe(404)
  })

  test('returns 401 when the timestamp header is missing or not a decimal integer', async () => {
    configureNetcodeV2()
    const cache = new TenantPubkeyCache(vi.fn().mockResolvedValue(pubkeyHex))

    const timestamp = String(Date.now())
    const signature = signWebhookRequest(privateKey, timestamp, rawBody)

    expect(await checkDepartureWebhookAuth('', signature, rawBody, cache)).toBe(401)
    expect(await checkDepartureWebhookAuth('not-a-number', signature, rawBody, cache)).toBe(401)
    expect(await checkDepartureWebhookAuth('-100', signature, rawBody, cache)).toBe(401)
  })

  test('returns 401 when the timestamp is outside the replay window', async () => {
    configureNetcodeV2()
    const cache = new TenantPubkeyCache(vi.fn().mockResolvedValue(pubkeyHex))

    const staleTimestamp = String(Date.now() - 6 * 60 * 1000)
    const signature = signWebhookRequest(privateKey, staleTimestamp, rawBody)

    expect(await checkDepartureWebhookAuth(staleTimestamp, signature, rawBody, cache)).toBe(401)
  })

  test('returns 401 when the signature header is missing or not 64 bytes of base64', async () => {
    configureNetcodeV2()
    const cache = new TenantPubkeyCache(vi.fn().mockResolvedValue(pubkeyHex))

    const timestamp = String(Date.now())

    expect(await checkDepartureWebhookAuth(timestamp, '', rawBody, cache)).toBe(401)
    expect(await checkDepartureWebhookAuth(timestamp, 'not-valid-base64!!!', rawBody, cache)).toBe(
      401,
    )
    expect(
      await checkDepartureWebhookAuth(
        timestamp,
        Buffer.alloc(63).toString('base64'),
        rawBody,
        cache,
      ),
    ).toBe(401)
  })

  test('returns 401 when the signature does not cover the actual raw body (tampered)', async () => {
    configureNetcodeV2()
    const cache = new TenantPubkeyCache(vi.fn().mockResolvedValue(pubkeyHex))

    const timestamp = String(Date.now())
    const signature = signWebhookRequest(privateKey, timestamp, rawBody)
    const tamperedBody = Buffer.from('{"tenant":"someone-else"}', 'utf8')

    expect(await checkDepartureWebhookAuth(timestamp, signature, tamperedBody, cache)).toBe(401)
  })

  test('returns 401 when the key fetch fails (coordinator down/timeout)', async () => {
    configureNetcodeV2()
    const cache = new TenantPubkeyCache(vi.fn().mockRejectedValue(new Error('boom')))

    const timestamp = String(Date.now())
    const signature = signWebhookRequest(privateKey, timestamp, rawBody)

    expect(await checkDepartureWebhookAuth(timestamp, signature, rawBody, cache)).toBe(401)
  })

  test('returns null on a valid, fresh, correctly-signed request (fetches the key on first use)', async () => {
    configureNetcodeV2()
    const fetchPubkeyHex = vi.fn().mockResolvedValue(pubkeyHex)
    const cache = new TenantPubkeyCache(fetchPubkeyHex)

    const timestamp = String(Date.now())
    const signature = signWebhookRequest(privateKey, timestamp, rawBody)

    expect(await checkDepartureWebhookAuth(timestamp, signature, rawBody, cache)).toBeNull()
    expect(fetchPubkeyHex).toHaveBeenCalledTimes(1)
  })

  test('returns 401 when the signature does not verify against the fetched pubkey', async () => {
    configureNetcodeV2()
    const otherKeypair = generateKeyPairSync('ed25519')
    const cache = new TenantPubkeyCache(vi.fn().mockResolvedValue(pubkeyHex))

    const timestamp = String(Date.now())
    // Signed with a different keypair than the one the coordinator "returns".
    const signature = signWebhookRequest(otherKeypair.privateKey, timestamp, rawBody)

    expect(await checkDepartureWebhookAuth(timestamp, signature, rawBody, cache)).toBe(401)
  })

  test('rotation: re-fetches once and re-verifies when the cached key no longer matches', async () => {
    configureNetcodeV2()
    const rotatedKeypair = generateKeyPairSync('ed25519')
    const fetchPubkeyHex = vi
      .fn()
      .mockResolvedValueOnce(pubkeyHex)
      .mockResolvedValueOnce(rawPublicKeyHex(rotatedKeypair.publicKey))
    const cache = new TenantPubkeyCache(fetchPubkeyHex)
    // Prime the cache with the "old" (soon to be stale) key.
    await cache.getKey()

    const timestamp = String(Date.now())
    // Signed with the *new* (rotated) key — verification against the stale cached key fails first.
    const signature = signWebhookRequest(rotatedKeypair.privateKey, timestamp, rawBody)

    expect(await checkDepartureWebhookAuth(timestamp, signature, rawBody, cache)).toBeNull()
    expect(fetchPubkeyHex).toHaveBeenCalledTimes(2)
  })

  test('re-fetch rate limit: a second verification failure within the cooldown does not re-fetch', async () => {
    configureNetcodeV2()
    const attackerKeypair = generateKeyPairSync('ed25519')
    const fetchPubkeyHex = vi.fn().mockResolvedValue(pubkeyHex)
    const cache = new TenantPubkeyCache(fetchPubkeyHex)
    await cache.getKey() // primes the cache: one fetch so far

    const timestamp = String(Date.now())
    const badSignature = signWebhookRequest(attackerKeypair.privateKey, timestamp, rawBody)

    // First garbage signature: fails against the cached key, triggers one rate-limited re-fetch
    // attempt (which returns the same key, so it still fails).
    expect(await checkDepartureWebhookAuth(timestamp, badSignature, rawBody, cache)).toBe(401)
    expect(fetchPubkeyHex).toHaveBeenCalledTimes(2)

    // A second garbage signature immediately after is well inside the 30s cooldown — must not
    // trigger another request to the coordinator.
    expect(await checkDepartureWebhookAuth(timestamp, badSignature, rawBody, cache)).toBe(401)
    expect(fetchPubkeyHex).toHaveBeenCalledTimes(2)
  })
})

describe('netcode-v2/recordDepartureNotification', () => {
  beforeEach(() => {
    asMockedFunction(recordUserDeparture).mockReset()
  })

  test('records the departure when it is genuine', async () => {
    asMockedFunction(recordUserDeparture).mockResolvedValue(true)

    await recordDepartureNotification(makeNotification({ kind: 'dropped' }))

    expect(recordUserDeparture).toHaveBeenCalledWith({
      userId: makeSbUserId(42),
      gameId: GAME_ID,
      kind: 'dropped',
      time: expect.any(Date),
    })
  })

  test('completes without error on a duplicate departure', async () => {
    asMockedFunction(recordUserDeparture).mockResolvedValue(false)

    await expect(recordDepartureNotification(makeNotification())).resolves.toBeUndefined()

    expect(recordUserDeparture).toHaveBeenCalledTimes(1)
  })

  test('does not call the model when externalRef is not an integer', async () => {
    await recordDepartureNotification(makeNotification({ externalRef: 'not-a-number' }))

    expect(recordUserDeparture).not.toHaveBeenCalled()
  })

  test('does not call the model when externalRef is missing', async () => {
    await recordDepartureNotification(makeNotification({ externalRef: undefined }))

    expect(recordUserDeparture).not.toHaveBeenCalled()
  })

  test('does not call the model when externalId is not a valid gameId', async () => {
    await recordDepartureNotification(makeNotification({ externalId: 'not-a-uuid' }))

    expect(recordUserDeparture).not.toHaveBeenCalled()
  })

  test('does not call the model when externalId is missing', async () => {
    await recordDepartureNotification(makeNotification({ externalId: undefined }))

    expect(recordUserDeparture).not.toHaveBeenCalled()
  })
})
