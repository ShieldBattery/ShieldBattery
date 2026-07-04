import {
  KeyObject,
  generateKeyPairSync,
  sign as signEd25519,
  verify as verifyEd25519,
} from 'node:crypto'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { NetcodeV2DepartureNotification } from '../../../common/games/netcode-v2'
import { asMockedFunction } from '../../../common/testing/mocks'
import { makeSbUserId } from '../../../common/users/sb-user-id'
import { recordUserDeparture } from '../models/games-users'
import {
  parseTenantPublicKeyHex,
  recordDepartureNotification,
} from './netcode-v2-departure-service'

vi.mock('../models/games-users', () => ({
  recordUserDeparture: vi.fn(),
}))

const GAME_ID = '11111111-2222-4333-8444-555555555555'

/** Raw 32-byte Ed25519 public key, hex-encoded — the `SB_RP2_TENANT_PUBKEY` format. */
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

describe('netcode-v2/parseTenantPublicKeyHex', () => {
  test('returns undefined when the value is undefined', () => {
    expect(parseTenantPublicKeyHex(undefined)).toBeUndefined()
  })

  test('returns undefined when the value is not 64 hex characters', () => {
    expect(parseTenantPublicKeyHex('not-hex')).toBeUndefined()
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

describe('netcode-v2/checkDepartureWebhookAuth', () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const otherKeypair = generateKeyPairSync('ed25519')
  const pubkeyHex = rawPublicKeyHex(publicKey)
  const rawBody = Buffer.from('{"tenant":"sb-dev"}', 'utf8')

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  // `checkDepartureWebhookAuth` reads `SB_RP2_TENANT_PUBKEY` into a module-level constant at
  // import time (deliberately not per-call), so exercising each pubkey scenario needs a fresh
  // module instance loaded with that env value already in place.
  async function checkAuthWithPubkey(hex: string | undefined) {
    vi.stubEnv('SB_RP2_TENANT_PUBKEY', hex)
    vi.resetModules()
    return (await import('./netcode-v2-departure-service')).checkDepartureWebhookAuth
  }

  test('returns 404 when no pubkey is configured, regardless of the headers', async () => {
    const checkAuth = await checkAuthWithPubkey(undefined)

    const timestamp = String(Date.now())
    const signature = signWebhookRequest(privateKey, timestamp, rawBody)

    expect(checkAuth(timestamp, signature, rawBody)).toBe(404)
    expect(checkAuth('', '', rawBody)).toBe(404)
  })

  test('returns 404 when the configured pubkey is malformed (not 64 hex chars)', async () => {
    const checkAuth = await checkAuthWithPubkey('not-hex')

    const timestamp = String(Date.now())
    const signature = signWebhookRequest(privateKey, timestamp, rawBody)

    expect(checkAuth(timestamp, signature, rawBody)).toBe(404)
  })

  test('returns 401 when the timestamp header is missing or not a decimal integer', async () => {
    const checkAuth = await checkAuthWithPubkey(pubkeyHex)

    const timestamp = String(Date.now())
    const signature = signWebhookRequest(privateKey, timestamp, rawBody)

    expect(checkAuth('', signature, rawBody)).toBe(401)
    expect(checkAuth('not-a-number', signature, rawBody)).toBe(401)
    expect(checkAuth('-100', signature, rawBody)).toBe(401)
  })

  test('returns 401 when the timestamp is outside the replay window', async () => {
    const checkAuth = await checkAuthWithPubkey(pubkeyHex)

    const staleTimestamp = String(Date.now() - 6 * 60 * 1000)
    const signature = signWebhookRequest(privateKey, staleTimestamp, rawBody)

    expect(checkAuth(staleTimestamp, signature, rawBody)).toBe(401)
  })

  test('returns 401 when the signature header is missing or not 64 bytes of base64', async () => {
    const checkAuth = await checkAuthWithPubkey(pubkeyHex)

    const timestamp = String(Date.now())

    expect(checkAuth(timestamp, '', rawBody)).toBe(401)
    expect(checkAuth(timestamp, 'not-valid-base64!!!', rawBody)).toBe(401)
    expect(checkAuth(timestamp, Buffer.alloc(63).toString('base64'), rawBody)).toBe(401)
  })

  test('returns 401 when the signature does not verify against the configured pubkey', async () => {
    const checkAuth = await checkAuthWithPubkey(pubkeyHex)

    const timestamp = String(Date.now())
    // Signed with a different keypair than the one whose public half is configured.
    const signature = signWebhookRequest(otherKeypair.privateKey, timestamp, rawBody)

    expect(checkAuth(timestamp, signature, rawBody)).toBe(401)
  })

  test('returns 401 when the signature does not cover the actual raw body (tampered)', async () => {
    const checkAuth = await checkAuthWithPubkey(pubkeyHex)

    const timestamp = String(Date.now())
    const signature = signWebhookRequest(privateKey, timestamp, rawBody)
    const tamperedBody = Buffer.from('{"tenant":"someone-else"}', 'utf8')

    expect(checkAuth(timestamp, signature, tamperedBody)).toBe(401)
  })

  test('returns null on a valid, fresh, correctly-signed request', async () => {
    const checkAuth = await checkAuthWithPubkey(pubkeyHex)

    const timestamp = String(Date.now())
    const signature = signWebhookRequest(privateKey, timestamp, rawBody)

    expect(checkAuth(timestamp, signature, rawBody)).toBeNull()
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
