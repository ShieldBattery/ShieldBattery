import { KeyObject, generateKeyPairSync, sign as signEd25519 } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  NetcodeV2DepartureNotification,
  NetcodeV2DesyncNotification,
  NetcodeV2ResultNotification,
} from '../../../common/games/netcode-v2'
import {
  GameClientResult,
  GameResultErrorCode,
  SubmitGameResultsRequest,
} from '../../../common/games/results'
import { asMockedFunction } from '../../../common/testing/mocks'
import { makeSbUserId } from '../../../common/users/sb-user-id'
import { GameResultServiceError } from '../games/game-result-service'
import { recordDesyncEvent } from '../models/game-desync-events'
import { recordUserDeparture } from '../models/games-users'
import {
  checkGameEventWebhookAuth,
  recordDepartureNotification,
  recordDesyncNotification,
  recordResultNotification,
} from './netcode-v2-game-event-service'
import { TenantPubkeyCache } from './tenant-pubkey-cache'

vi.mock('../models/games-users', () => ({
  recordUserDeparture: vi.fn(),
}))
vi.mock('../models/game-desync-events', () => ({
  recordDesyncEvent: vi.fn(),
}))

const GAME_ID = '11111111-2222-4333-8444-555555555555'

/** Raw 32-byte Ed25519 public key, hex-encoded — the wire format the coordinator returns. */
function rawPublicKeyHex(publicKey: KeyObject): string {
  return (publicKey.export({ type: 'spki', format: 'der' }) as Buffer).subarray(-32).toString('hex')
}

/** Signs a game-events webhook request exactly as the production verification expects. */
function signWebhookRequest(privateKey: KeyObject, timestamp: string, rawBody: Buffer): string {
  const message = Buffer.concat([Buffer.from(`rp2-webhook-v1:${timestamp}:`, 'utf8'), rawBody])
  return signEd25519(null, message, privateKey).toString('base64')
}

function makeDepartureNotification(
  overrides: Partial<NetcodeV2DepartureNotification> = {},
): NetcodeV2DepartureNotification {
  return {
    event: 'departure',
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

function makeDesyncNotification(
  overrides: Partial<NetcodeV2DesyncNotification> = {},
): NetcodeV2DesyncNotification {
  return {
    event: 'desync',
    tenant: 'sb-dev',
    session: 1,
    externalId: GAME_ID,
    syncOrdinal: 17,
    gameFrame: 512,
    detectedAtMs: Date.now(),
    noMajority: false,
    diverged: [{ slot: 2, externalRef: '42' }],
    ...overrides,
  }
}

/** base64-encodes a `SubmitGameResultsRequest` the way the DLL's opaque relay payload would be. */
function encodeResultPayload(overrides: Partial<SubmitGameResultsRequest> = {}): string {
  const body: SubmitGameResultsRequest = {
    userId: makeSbUserId(42),
    resultCode: 'abc123',
    time: 12345,
    playerResults: [[makeSbUserId(42), { result: GameClientResult.Victory, race: 'z', apm: 100 }]],
    ...overrides,
  }
  return Buffer.from(JSON.stringify(body), 'utf8').toString('base64')
}

function makeResultNotification(
  overrides: Partial<NetcodeV2ResultNotification> = {},
): NetcodeV2ResultNotification {
  return {
    event: 'result',
    tenant: 'sb-dev',
    session: 1,
    externalId: GAME_ID,
    slot: 0,
    externalRef: '42',
    payload: encodeResultPayload(),
    arrivalMs: Date.now(),
    sessionFrame: 100,
    ...overrides,
  }
}

describe('netcode-v2/checkGameEventWebhookAuth', () => {
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

    expect(await checkGameEventWebhookAuth(timestamp, signature, rawBody, cache)).toBe(404)
    expect(await checkGameEventWebhookAuth('', '', rawBody, cache)).toBe(404)
  })

  test('returns 401 when the timestamp header is missing or not a decimal integer', async () => {
    configureNetcodeV2()
    const cache = new TenantPubkeyCache(vi.fn().mockResolvedValue(pubkeyHex))

    const timestamp = String(Date.now())
    const signature = signWebhookRequest(privateKey, timestamp, rawBody)

    expect(await checkGameEventWebhookAuth('', signature, rawBody, cache)).toBe(401)
    expect(await checkGameEventWebhookAuth('not-a-number', signature, rawBody, cache)).toBe(401)
    expect(await checkGameEventWebhookAuth('-100', signature, rawBody, cache)).toBe(401)
  })

  test('returns 401 when the timestamp is outside the replay window', async () => {
    configureNetcodeV2()
    const cache = new TenantPubkeyCache(vi.fn().mockResolvedValue(pubkeyHex))

    const staleTimestamp = String(Date.now() - 6 * 60 * 1000)
    const signature = signWebhookRequest(privateKey, staleTimestamp, rawBody)

    expect(await checkGameEventWebhookAuth(staleTimestamp, signature, rawBody, cache)).toBe(401)
  })

  test('returns 401 when the signature header is missing or not 64 bytes of base64', async () => {
    configureNetcodeV2()
    const cache = new TenantPubkeyCache(vi.fn().mockResolvedValue(pubkeyHex))

    const timestamp = String(Date.now())

    expect(await checkGameEventWebhookAuth(timestamp, '', rawBody, cache)).toBe(401)
    expect(await checkGameEventWebhookAuth(timestamp, 'not-valid-base64!!!', rawBody, cache)).toBe(
      401,
    )
    expect(
      await checkGameEventWebhookAuth(
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

    expect(await checkGameEventWebhookAuth(timestamp, signature, tamperedBody, cache)).toBe(401)
  })

  test('returns 401 when the key fetch fails (coordinator down/timeout)', async () => {
    configureNetcodeV2()
    const cache = new TenantPubkeyCache(vi.fn().mockRejectedValue(new Error('boom')))

    const timestamp = String(Date.now())
    const signature = signWebhookRequest(privateKey, timestamp, rawBody)

    expect(await checkGameEventWebhookAuth(timestamp, signature, rawBody, cache)).toBe(401)
  })

  test('returns null on a valid, fresh, correctly-signed request (fetches the key on first use)', async () => {
    configureNetcodeV2()
    const fetchPubkeyHex = vi.fn().mockResolvedValue(pubkeyHex)
    const cache = new TenantPubkeyCache(fetchPubkeyHex)

    const timestamp = String(Date.now())
    const signature = signWebhookRequest(privateKey, timestamp, rawBody)

    expect(await checkGameEventWebhookAuth(timestamp, signature, rawBody, cache)).toBeNull()
    expect(fetchPubkeyHex).toHaveBeenCalledTimes(1)
  })

  test('returns 401 when the signature does not verify against the fetched pubkey', async () => {
    configureNetcodeV2()
    const otherKeypair = generateKeyPairSync('ed25519')
    const cache = new TenantPubkeyCache(vi.fn().mockResolvedValue(pubkeyHex))

    const timestamp = String(Date.now())
    // Signed with a different keypair than the one the coordinator "returns".
    const signature = signWebhookRequest(otherKeypair.privateKey, timestamp, rawBody)

    expect(await checkGameEventWebhookAuth(timestamp, signature, rawBody, cache)).toBe(401)
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

    expect(await checkGameEventWebhookAuth(timestamp, signature, rawBody, cache)).toBeNull()
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
    expect(await checkGameEventWebhookAuth(timestamp, badSignature, rawBody, cache)).toBe(401)
    expect(fetchPubkeyHex).toHaveBeenCalledTimes(2)

    // A second garbage signature immediately after is well inside the 30s cooldown — must not
    // trigger another request to the coordinator.
    expect(await checkGameEventWebhookAuth(timestamp, badSignature, rawBody, cache)).toBe(401)
    expect(fetchPubkeyHex).toHaveBeenCalledTimes(2)
  })
})

describe('netcode-v2/recordDepartureNotification', () => {
  beforeEach(() => {
    asMockedFunction(recordUserDeparture).mockReset()
  })

  test('records the departure when it is genuine', async () => {
    asMockedFunction(recordUserDeparture).mockResolvedValue(true)
    const scheduleKnownCompleteReconcile = vi.fn().mockResolvedValue(undefined)

    await recordDepartureNotification(
      makeDepartureNotification({ kind: 'dropped' }),
      scheduleKnownCompleteReconcile,
    )

    expect(recordUserDeparture).toHaveBeenCalledWith({
      userId: makeSbUserId(42),
      gameId: GAME_ID,
      kind: 'dropped',
      time: expect.any(Date),
    })
    expect(scheduleKnownCompleteReconcile).toHaveBeenCalledWith(GAME_ID)
  })

  test('completes without error on a duplicate departure, and still checks reconcile eligibility', async () => {
    asMockedFunction(recordUserDeparture).mockResolvedValue(false)
    const scheduleKnownCompleteReconcile = vi.fn().mockResolvedValue(undefined)

    await expect(
      recordDepartureNotification(makeDepartureNotification(), scheduleKnownCompleteReconcile),
    ).resolves.toBeUndefined()

    expect(recordUserDeparture).toHaveBeenCalledTimes(1)
    expect(scheduleKnownCompleteReconcile).toHaveBeenCalledWith(GAME_ID)
  })

  test('does not call the model when externalRef is not an integer', async () => {
    const scheduleKnownCompleteReconcile = vi.fn()

    await recordDepartureNotification(
      makeDepartureNotification({ externalRef: 'not-a-number' }),
      scheduleKnownCompleteReconcile,
    )

    expect(recordUserDeparture).not.toHaveBeenCalled()
    expect(scheduleKnownCompleteReconcile).not.toHaveBeenCalled()
  })

  test('does not call the model when externalRef is missing', async () => {
    await recordDepartureNotification(makeDepartureNotification({ externalRef: undefined }))

    expect(recordUserDeparture).not.toHaveBeenCalled()
  })

  test('does not call the model when externalId is not a valid gameId', async () => {
    const scheduleKnownCompleteReconcile = vi.fn()

    await recordDepartureNotification(
      makeDepartureNotification({ externalId: 'not-a-uuid' }),
      scheduleKnownCompleteReconcile,
    )

    expect(recordUserDeparture).not.toHaveBeenCalled()
    expect(scheduleKnownCompleteReconcile).not.toHaveBeenCalled()
  })

  test('does not call the model when externalId is missing', async () => {
    await recordDepartureNotification(makeDepartureNotification({ externalId: undefined }))

    expect(recordUserDeparture).not.toHaveBeenCalled()
  })
})

describe('netcode-v2/recordDesyncNotification', () => {
  beforeEach(() => {
    asMockedFunction(recordDesyncEvent).mockReset()
  })

  test('records the desync event with parsed diverged user ids', async () => {
    asMockedFunction(recordDesyncEvent).mockResolvedValue(true)

    await recordDesyncNotification(makeDesyncNotification())

    expect(recordDesyncEvent).toHaveBeenCalledWith({
      gameId: GAME_ID,
      syncOrdinal: 17,
      detectedAt: expect.any(Date),
      gameFrame: 512,
      noMajority: false,
      divergedUserIds: [makeSbUserId(42)],
    })
  })

  test('completes without error on a duplicate (game_id, sync_ordinal)', async () => {
    asMockedFunction(recordDesyncEvent).mockResolvedValue(false)

    await expect(recordDesyncNotification(makeDesyncNotification())).resolves.toBeUndefined()

    expect(recordDesyncEvent).toHaveBeenCalledTimes(1)
  })

  test('persists a no-majority event with an empty diverged set', async () => {
    asMockedFunction(recordDesyncEvent).mockResolvedValue(true)

    await recordDesyncNotification(makeDesyncNotification({ noMajority: true, diverged: [] }))

    expect(recordDesyncEvent).toHaveBeenCalledWith(
      expect.objectContaining({ noMajority: true, divergedUserIds: [] }),
    )
  })

  test('skips diverged entries with a missing/unparseable externalRef but still records the rest', async () => {
    asMockedFunction(recordDesyncEvent).mockResolvedValue(true)

    await recordDesyncNotification(
      makeDesyncNotification({
        diverged: [
          { slot: 1, externalRef: 'not-a-number' },
          { slot: 2, externalRef: '42' },
          { slot: 3 },
        ],
      }),
    )

    expect(recordDesyncEvent).toHaveBeenCalledWith(
      expect.objectContaining({ divergedUserIds: [makeSbUserId(42)] }),
    )
  })

  test('does not call the model when externalId is not a valid gameId', async () => {
    await recordDesyncNotification(makeDesyncNotification({ externalId: 'not-a-uuid' }))

    expect(recordDesyncEvent).not.toHaveBeenCalled()
  })

  test('does not call the model when externalId is missing (unknown game warns + accepts)', async () => {
    await recordDesyncNotification(makeDesyncNotification({ externalId: undefined }))

    expect(recordDesyncEvent).not.toHaveBeenCalled()
  })
})

describe('netcode-v2/recordResultNotification', () => {
  test('submits the decoded report and stamps relay fields', async () => {
    const submitGameResults = vi.fn().mockResolvedValue(undefined)
    const scheduleKnownCompleteReconcile = vi.fn().mockResolvedValue(undefined)
    const notification = makeResultNotification()

    await recordResultNotification(notification, submitGameResults, scheduleKnownCompleteReconcile)

    expect(submitGameResults).toHaveBeenCalledWith({
      gameId: GAME_ID,
      userId: makeSbUserId(42),
      resultCode: 'abc123',
      time: 12345,
      playerResults: [
        [makeSbUserId(42), { result: GameClientResult.Victory, race: 'z', apm: 100 }],
      ],
      relayReportTime: new Date(notification.arrivalMs),
      relayReportFrame: 100,
      logger: expect.anything(),
    })
    expect(scheduleKnownCompleteReconcile).toHaveBeenCalledWith(GAME_ID)
  })

  test('stamps a null relayReportFrame when sessionFrame is absent', async () => {
    const submitGameResults = vi.fn().mockResolvedValue(undefined)

    await recordResultNotification(
      makeResultNotification({ sessionFrame: undefined }),
      submitGameResults,
      vi.fn().mockResolvedValue(undefined),
    )

    expect(submitGameResults).toHaveBeenCalledWith(
      expect.objectContaining({ relayReportFrame: null }),
    )
  })

  test('completes silently on a duplicate (AlreadyReported) submission, without checking reconcile eligibility', async () => {
    const submitGameResults = vi
      .fn()
      .mockRejectedValue(new GameResultServiceError(GameResultErrorCode.AlreadyReported, 'dup'))
    const scheduleKnownCompleteReconcile = vi.fn()

    await expect(
      recordResultNotification(
        makeResultNotification(),
        submitGameResults,
        scheduleKnownCompleteReconcile,
      ),
    ).resolves.toBeUndefined()
    expect(scheduleKnownCompleteReconcile).not.toHaveBeenCalled()
  })

  test('drops (without throwing) on other submission-service errors', async () => {
    const submitGameResults = vi
      .fn()
      .mockRejectedValue(new GameResultServiceError(GameResultErrorCode.NotFound, 'no game'))

    await expect(
      recordResultNotification(makeResultNotification(), submitGameResults),
    ).resolves.toBeUndefined()
  })

  test('rethrows an unexpected (non-domain) error from the submission service', async () => {
    const submitGameResults = vi.fn().mockRejectedValue(new Error('boom'))

    await expect(
      recordResultNotification(makeResultNotification(), submitGameResults),
    ).rejects.toThrow('boom')
  })

  test('drops a payload that cannot be decoded as base64 JSON, without throwing', async () => {
    const submitGameResults = vi.fn()
    const notification = makeResultNotification({ payload: '!!!not valid base64 json!!!' })

    await expect(recordResultNotification(notification, submitGameResults)).resolves.toBeUndefined()
    expect(submitGameResults).not.toHaveBeenCalled()
  })

  test('drops a payload that fails schema validation, without throwing', async () => {
    const submitGameResults = vi.fn()
    const badPayload = Buffer.from(JSON.stringify({ userId: 42 }), 'utf8').toString('base64')
    const notification = makeResultNotification({ payload: badPayload })

    await expect(recordResultNotification(notification, submitGameResults)).resolves.toBeUndefined()
    expect(submitGameResults).not.toHaveBeenCalled()
  })

  test('drops a payload whose userId does not match externalRef', async () => {
    const submitGameResults = vi.fn()
    const notification = makeResultNotification({
      externalRef: '99',
      payload: encodeResultPayload({ userId: makeSbUserId(42) }),
    })

    await expect(recordResultNotification(notification, submitGameResults)).resolves.toBeUndefined()
    expect(submitGameResults).not.toHaveBeenCalled()
  })

  test('does not call the service when externalId is missing', async () => {
    const submitGameResults = vi.fn()

    await recordResultNotification(
      makeResultNotification({ externalId: undefined }),
      submitGameResults,
    )

    expect(submitGameResults).not.toHaveBeenCalled()
  })

  test('does not call the service when externalRef is missing', async () => {
    const submitGameResults = vi.fn()

    await recordResultNotification(
      makeResultNotification({ externalRef: undefined }),
      submitGameResults,
    )

    expect(submitGameResults).not.toHaveBeenCalled()
  })
})
