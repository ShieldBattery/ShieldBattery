import got from 'got'
import { createPublicKey, sign } from 'node:crypto'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { makeGameServerRegionId } from '../../../common/game-server-regions'
import { asMockedFunction } from '../../../common/testing/mocks'
import { makeSbUserId } from '../../../common/users/sb-user-id'
import { addNetcodeV2RelayEvents } from '../games/game-models'
import {
  checkSessionsAlive,
  clientSigningKeyFromSeedHex,
  NetcodeV2Service,
} from './netcode-v2-service'

vi.mock('got', () => ({
  default: {
    post: vi.fn(),
  },
}))

// The session id + relay history persistence are best-effort DB writes; stub them so the
// create/rehome paths don't reach a real database.
vi.mock('../games/game-models', () => ({
  setNetcodeV2Session: vi.fn().mockResolvedValue(undefined),
  addNetcodeV2RelayEvents: vi.fn().mockResolvedValue(undefined),
}))

/** A valid `SB_RP2_CLIENT_KEY` fixture (64 hex chars = a 32-byte Ed25519 seed). */
const TEST_CLIENT_SEED_HEX = '11'.repeat(32)

// A valid self-signed DER cert (as the coordinator's byte-array JSON), so decoding a relay endpoint
// through relayEndpointToInfo's X509 parse succeeds; its contents are irrelevant beyond parsing.
const RELAY_CERT_DER = [
  ...Buffer.from(
    'MIIDCzCCAfOgAwIBAgIUY0gCPMTEgUEmeHE4scZYjRS8sOEwDQYJKoZIhvcNAQELBQAwFTETMBEGA1UEAwwK' +
      'dGVzdC1yZWxheTAeFw0yNjA3MDkwOTU1NDRaFw0zNjA3MDYwOTU1NDRaMBUxEzARBgNVBAMMCnRlc3QtcmVs' +
      'YXkwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQDa6ge92CEx50zoAmzI9pUQQvl6uh0/WmHKfBdI' +
      'qdDIHy/IWcfE/5j7383EiuXp07xagLFCXn+6fjeP85U7iGsekHVPm4qnrrDITBPFZNPoQGkpOUgzJks+gEpT' +
      'dUrMMniFPK6W+5eT6cbUjUmXfKlDGWySZ+7FqGxs1aWsfVU9HDs3VlFobb9Leq+dsbPfGMxIMMZtgti/TKj4' +
      'kVNv7gzaQdf3EWRxhttckJlZfuWM+UmTNtrKWyilHYiOkEvSg2Bvpx+sFpbqK+9iOr3LiFbe+NrXOGLEskZM' +
      'OZxHWx29HOQyl11YZoE+SquPRjz5KFQMdQgvOzMUewc42i6HoLTpAgMBAAGjUzBRMB0GA1UdDgQWBBQA/z4b' +
      'mvw4DMS4O2/8uKiKlaJRFjAfBgNVHSMEGDAWgBQA/z4bmvw4DMS4O2/8uKiKlaJRFjAPBgNVHRMBAf8EBTAD' +
      'AQH/MA0GCSqGSIb3DQEBCwUAA4IBAQAECiLK+6liP56mdxv0w+bzzDXeLpPibUJXZfuJkRMnuxfcMNxdnq65' +
      'AKeNiCEthU2ibJvL2dmHQW7MPhV4DIlzDBY9gGjfaosGim8t0o7Iccj00TnWlQZ7H9SfSqXfhqmDOOgWJC9q' +
      'S1/EfInTOFKd2M7nV/A/HInZu3Vcq4LRhSh3a+HnPrcb0o0OHS6TbifhFdc2q0qorYOh7Bm0FLCeFMcw/Occ' +
      'pDg4zfbWbyy0xaDIrzNbPRWL/FvxVd2mpGPsWB3xKyGPA6boFUsvNQZQlz4BrZ1Pvur+PnISj01rgl8FYsZ+' +
      'lZC8tZ1GllB3DmAUBIavxKH/9FsNXk26JNuM',
    'base64',
  ),
]

/**
 * Stubs netcode v2 as configured (coordinator URL + tenant + client key), as `loadConfigFromEnv`
 * expects — the client key is required whenever the coordinator URL is set.
 */
function configureNetcodeV2() {
  vi.stubEnv('SB_RP2_COORDINATOR_URL', 'http://coordinator.example')
  vi.stubEnv('SB_RP2_TENANT', 'sb-dev')
  vi.stubEnv('SB_RP2_CLIENT_KEY', TEST_CLIENT_SEED_HEX)
}

describe('netcode-v2/checkSessionsAlive', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.clearAllMocks()
  })

  test('throws when netcode v2 is not configured', async () => {
    await expect(checkSessionsAlive([1, 2, 3])).rejects.toThrow('netcode v2 is not configured')
    expect(got.post).not.toHaveBeenCalled()
  })

  test('returns an empty set without a network call for an empty session list', async () => {
    configureNetcodeV2()

    const result = await checkSessionsAlive([])

    expect(result).toEqual(new Set())
    expect(got.post).not.toHaveBeenCalled()
  })

  test('posts the tenant + full session list (as a signed body) and returns the alive set', async () => {
    configureNetcodeV2()
    const json = vi.fn().mockResolvedValue({ alive: [1, 3] })
    asMockedFunction(got.post).mockReturnValue({ json } as any)

    const result = await checkSessionsAlive([1, 2, 3])

    expect(got.post).toHaveBeenCalledWith(
      'http://coordinator.example/sessions/alive',
      expect.objectContaining({
        body: JSON.stringify({ tenant: 'sb-dev', sessions: [1, 2, 3] }),
        headers: expect.objectContaining({
          'content-type': 'application/json',
          'x-rp2-timestamp': expect.stringMatching(/^\d+$/),
          'x-rp2-signature': expect.stringMatching(/^[0-9a-f]{128}$/),
        }),
      }),
    )
    expect(result).toEqual(new Set([1, 3]))
  })

  test('omits a session the coordinator did not report as alive', async () => {
    configureNetcodeV2()
    const json = vi.fn().mockResolvedValue({ alive: [1] })
    asMockedFunction(got.post).mockReturnValue({ json } as any)

    const result = await checkSessionsAlive([1, 2])

    expect(result.has(2)).toBe(false)
  })

  test('chunks requests at the batch size and merges the alive sets', async () => {
    configureNetcodeV2()
    const sessions = Array.from({ length: 600 }, (_, i) => i)
    const json = vi
      .fn()
      .mockResolvedValueOnce({ alive: [0] })
      .mockResolvedValueOnce({ alive: [512] })
    asMockedFunction(got.post).mockReturnValue({ json } as any)

    const result = await checkSessionsAlive(sessions)

    expect(got.post).toHaveBeenCalledTimes(2)
    const firstChunk = asMockedFunction(got.post).mock.calls[0][1] as any
    const secondChunk = asMockedFunction(got.post).mock.calls[1][1] as any
    expect(JSON.parse(firstChunk.body).sessions).toHaveLength(512)
    expect(JSON.parse(secondChunk.body).sessions).toHaveLength(88)
    expect(result).toEqual(new Set([0, 512]))
  })

  test('propagates a request failure', async () => {
    configureNetcodeV2()
    asMockedFunction(got.post).mockImplementation(() => {
      throw new Error('coordinator down')
    })

    await expect(checkSessionsAlive([1])).rejects.toThrow('coordinator down')
  })

  test('fails loudly when the coordinator is configured without a client key', async () => {
    vi.stubEnv('SB_RP2_COORDINATOR_URL', 'http://coordinator.example')
    vi.stubEnv('SB_RP2_TENANT', 'sb-dev')
    // No SB_RP2_CLIENT_KEY — the config load must reject rather than defer to request time.
    await expect(checkSessionsAlive([1])).rejects.toThrow('SB_RP2_CLIENT_KEY is missing')
    expect(got.post).not.toHaveBeenCalled()
  })

  test('rejects a malformed client key at config time', async () => {
    vi.stubEnv('SB_RP2_COORDINATOR_URL', 'http://coordinator.example')
    vi.stubEnv('SB_RP2_TENANT', 'sb-dev')
    vi.stubEnv('SB_RP2_CLIENT_KEY', 'not-hex')
    await expect(checkSessionsAlive([1])).rejects.toThrow('SB_RP2_CLIENT_KEY must be 64 hex')
    expect(got.post).not.toHaveBeenCalled()
  })
})

describe('netcode-v2/request signing', () => {
  // RFC 8032 §7.1 test vector 1 seed + its derived public key, the same vector pinned in
  // app/game/netcode-v2-keys.test.ts and the coordinator's tenant.rs / api.rs tests.
  const RFC8032_SEED_HEX = '9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60'
  const RFC8032_PUBLIC_HEX = 'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a'
  // A fixed canonical request message and the Ed25519 signature the coordinator's ring-based test
  // pins byte-for-byte. Ed25519 is deterministic, so Node and ring produce identical bytes — a
  // drift in either side's message construction breaks one of the two tests.
  const FIXED_MESSAGE = 'rp2-request-v1:1700000000:POST:/session/create:{"tenant":"sb-dev"}'
  const EXPECTED_SIGNATURE_HEX =
    '33a9c1ee42248bc26e7844a880a5c82512cf534b200937b607a2259b3ee8dded' +
    '4f1cae21671be4f949145ac5888874c845024daae6e1c405dd9a051a12d4f209'

  test('builds a KeyObject from the seed whose public half matches the RFC 8032 vector', () => {
    const key = clientSigningKeyFromSeedHex(RFC8032_SEED_HEX)
    const spki = createPublicKey(key).export({ type: 'spki', format: 'der' })
    expect(Buffer.from(spki.subarray(spki.length - 32)).toString('hex')).toBe(RFC8032_PUBLIC_HEX)
  })

  test('produces the cross-implementation signature vector byte-for-byte', () => {
    const key = clientSigningKeyFromSeedHex(RFC8032_SEED_HEX)
    const signature = sign(null, Buffer.from(FIXED_MESSAGE, 'utf8'), key)
    expect(signature.toString('hex')).toBe(EXPECTED_SIGNATURE_HEX)
  })

  test('rejects a malformed seed', () => {
    expect(() => clientSigningKeyFromSeedHex('not-hex')).toThrow('64 hex characters')
    expect(() => clientSigningKeyFromSeedHex('ab'.repeat(31))).toThrow('64 hex characters')
  })
})

describe('netcode-v2/NetcodeV2Service#rehomeSession', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.clearAllMocks()
  })

  // Mirrors the coordinator's snake_case CoordinatorRelayEndpoint wire shape.
  // eslint-disable-next-line camelcase
  const newTargetRelay = { relay_id: 2, relay_addr: '10.0.0.2:14900', cert_der: RELAY_CERT_DER }

  test('coalesces concurrent asks for the same session + dead relay into one coordinator call', async () => {
    configureNetcodeV2()
    // A coordinator response held open until we release it, so both asks are in flight together.
    let resolveJson: (v: unknown) => void = () => {}
    const json = vi.fn().mockReturnValue(
      new Promise(resolve => {
        resolveJson = resolve
      }),
    )
    asMockedFunction(got.post).mockReturnValue({ json } as any)
    const service = new NetcodeV2Service()

    const p1 = service.rehomeSession('game-1', 42, 7)
    const p2 = service.rehomeSession('game-1', 42, 7)
    resolveJson({ decision: 'newTarget', relay: newTargetRelay })
    const [r1, r2] = await Promise.all([p1, p2])

    expect(got.post).toHaveBeenCalledTimes(1)
    expect(r1.decision).toBe('newTarget')
    expect(r2).toEqual(r1)
  })

  test('records exactly one rehome event under coalesced concurrent asks', async () => {
    configureNetcodeV2()
    let resolveJson: (v: unknown) => void = () => {}
    const json = vi.fn().mockReturnValue(
      new Promise(resolve => {
        resolveJson = resolve
      }),
    )
    asMockedFunction(got.post).mockReturnValue({ json } as any)
    const service = new NetcodeV2Service()

    const p1 = service.rehomeSession('game-1', 42, 7)
    const p2 = service.rehomeSession('game-1', 42, 7)
    const p3 = service.rehomeSession('game-1', 42, 7)
    resolveJson({ decision: 'newTarget', relay: newTargetRelay })
    await Promise.all([p1, p2, p3])

    // Three coalesced asks for the same (session, deadRelayId) collapse into a single coordinator
    // round trip and must record a single rehome event, not one per asker.
    expect(addNetcodeV2RelayEvents).toHaveBeenCalledTimes(1)
    expect(addNetcodeV2RelayEvents).toHaveBeenCalledWith('game-1', [
      expect.objectContaining({
        kind: 'rehome',
        deadRelayId: 7,
        newRelayId: 2,
        newRelayAddr: '10.0.0.2:14900',
      }),
    ])
  })

  test('re-asks the coordinator for a staggered (non-concurrent) newTarget ask', async () => {
    configureNetcodeV2()
    const json = vi.fn().mockResolvedValue({ decision: 'newTarget', relay: newTargetRelay })
    asMockedFunction(got.post).mockReturnValue({ json } as any)
    const service = new NetcodeV2Service()

    const r1 = await service.rehomeSession('game-1', 42, 7)
    const r2 = await service.rehomeSession('game-1', 42, 7)

    // No terminal answer cache: once the first ask settles, a later survivor asking about the same
    // dead relay reaches the coordinator again (the recorded-rehome answer is idempotent, token-free
    // and re-liveness-checked), rather than being handed a possibly-stale cached target.
    expect(got.post).toHaveBeenCalledTimes(2)
    expect(r1.decision).toBe('newTarget')
    expect(r2).toEqual(r1)
  })

  test('a later ask re-reaches the coordinator when the replacement relay has itself died', async () => {
    configureNetcodeV2()
    // The relay 2 the first ask is sent has since died; the coordinator now moves the group to a
    // fresh relay 3. A cache would have livelocked survivors on the dead relay 2 forever.
    // eslint-disable-next-line camelcase
    const laterTargetRelay = { relay_id: 3, relay_addr: '10.0.0.3:14900', cert_der: RELAY_CERT_DER }
    const json = vi
      .fn()
      .mockResolvedValueOnce({ decision: 'newTarget', relay: newTargetRelay })
      .mockResolvedValueOnce({ decision: 'newTarget', relay: laterTargetRelay })
    asMockedFunction(got.post).mockReturnValue({ json } as any)
    const service = new NetcodeV2Service()

    const r1 = await service.rehomeSession('game-1', 42, 7)
    const r2 = await service.rehomeSession('game-1', 42, 7)

    expect(got.post).toHaveBeenCalledTimes(2)
    expect(r1).toMatchObject({ decision: 'newTarget', relay: { relayId: 2 } })
    expect(r2).toMatchObject({ decision: 'newTarget', relay: { relayId: 3 } })
  })

  test('re-asks the coordinator for a transient stay (never cached)', async () => {
    configureNetcodeV2()
    const json = vi.fn().mockResolvedValue({ decision: 'stay' })
    asMockedFunction(got.post).mockReturnValue({ json } as any)
    const service = new NetcodeV2Service()

    await service.rehomeSession('game-1', 42, 7)
    await service.rehomeSession('game-1', 42, 7)

    expect(got.post).toHaveBeenCalledTimes(2)
  })

  test('re-asks the coordinator for a transient unavailable (never cached)', async () => {
    configureNetcodeV2()
    const json = vi.fn().mockResolvedValue({ decision: 'unavailable' })
    asMockedFunction(got.post).mockReturnValue({ json } as any)
    const service = new NetcodeV2Service()

    await service.rehomeSession('game-1', 42, 7)
    await service.rehomeSession('game-1', 42, 7)

    expect(got.post).toHaveBeenCalledTimes(2)
  })

  test('a different dead relay on the same session is its own coordinator call', async () => {
    configureNetcodeV2()
    const json = vi.fn().mockResolvedValue({ decision: 'newTarget', relay: newTargetRelay })
    asMockedFunction(got.post).mockReturnValue({ json } as any)
    const service = new NetcodeV2Service()

    await service.rehomeSession('game-1', 42, 7)
    await service.rehomeSession('game-1', 42, 8)

    expect(got.post).toHaveBeenCalledTimes(2)
  })

  test('a rejected ask clears the in-flight entry so the next ask retries', async () => {
    configureNetcodeV2()
    const json = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ decision: 'newTarget', relay: newTargetRelay })
    asMockedFunction(got.post).mockReturnValue({ json } as any)
    const service = new NetcodeV2Service()

    await expect(service.rehomeSession('game-1', 42, 7)).rejects.toThrow(
      'coordinator session rehome failed',
    )
    const r2 = await service.rehomeSession('game-1', 42, 7)

    expect(got.post).toHaveBeenCalledTimes(2)
    expect(r2.decision).toBe('newTarget')
  })
})

describe('netcode-v2/NetcodeV2Service#createSessionForGame', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.clearAllMocks()
  })

  // eslint-disable-next-line camelcase
  const HOME_RELAY = { relay_id: 1, relay_addr: '10.0.0.1:14900', cert_der: RELAY_CERT_DER }
  /** A well-formed 32-byte pubkey (base64), as `registerPubkey` requires. */
  const PUBKEY = Buffer.alloc(32, 7).toString('base64')

  function sessionResponse(slots: number[]) {
    return {
      session: 100,
      // eslint-disable-next-line camelcase
      home_relay: HOME_RELAY,
      tokens: slots.map(slot => ({ slot, token: [slot] })),
      bounds: { min: 2, max: 8 },
    }
  }

  test('forwards each slot region (snake_case) and omits it when absent', async () => {
    configureNetcodeV2()
    const json = vi.fn().mockResolvedValue(sessionResponse([0, 1]))
    asMockedFunction(got.post).mockReturnValue({ json } as any)
    const service = new NetcodeV2Service()

    const u1 = makeSbUserId(1)
    const u2 = makeSbUserId(2)
    service.registerPubkey('game-1', u1, PUBKEY)
    service.registerPubkey('game-1', u2, PUBKEY)

    await service.createSessionForGame({
      gameId: 'game-1',
      slots: [
        { slot: 0, userId: u1, observer: false, region: makeGameServerRegionId('us-east') },
        { slot: 1, userId: u2, observer: true },
      ],
      signal: new AbortController().signal,
    })

    const createCall = asMockedFunction(got.post).mock.calls.find(c =>
      String(c[0]).endsWith('/session/create'),
    )!
    const body = JSON.parse((createCall[1] as any).body)
    expect(body.players).toEqual([
      expect.objectContaining({ slot: 0, observer: false, region: 'us-east' }),
      expect.objectContaining({ slot: 1, observer: true }),
    ])
    // The region-less slot must not carry the key at all (rather than a null/undefined value).
    expect(body.players[1]).not.toHaveProperty('region')
  })

  test('adds a ceiled latency_estimate_ms to the request body when slots carry a latency signal', async () => {
    configureNetcodeV2()
    const json = vi.fn().mockResolvedValue(sessionResponse([0, 1]))
    asMockedFunction(got.post).mockReturnValue({ json } as any)
    const service = new NetcodeV2Service()

    const u1 = makeSbUserId(1)
    const u2 = makeSbUserId(2)
    service.registerPubkey('game-1', u1, PUBKEY)
    service.registerPubkey('game-1', u2, PUBKEY)

    await service.createSessionForGame({
      gameId: 'game-1',
      slots: [
        {
          slot: 0,
          userId: u1,
          observer: false,
          region: makeGameServerRegionId('us-east'),
          rttMs: 21,
        },
        {
          slot: 1,
          userId: u2,
          observer: false,
          region: makeGameServerRegionId('us-east'),
          rttMs: 22,
        },
      ],
      signal: new AbortController().signal,
    })

    const createCall = asMockedFunction(got.post).mock.calls.find(c =>
      String(c[0]).endsWith('/session/create'),
    )!
    const body = JSON.parse((createCall[1] as any).body)
    // Same region, so the one-way estimate is rtt halves only: 21/2 + 22/2 = 21.5ms, ceiled to 22.
    expect(body.latency_estimate_ms).toBe(22)
  })

  test("uses the configured backbone table for a cross-region pair's latency_estimate_ms", async () => {
    vi.stubEnv('SB_REGION_BACKBONE_RTT_JSON', JSON.stringify({ 'us-east|eu-west': 90 }))
    configureNetcodeV2()
    const json = vi.fn().mockResolvedValue(sessionResponse([0, 1]))
    asMockedFunction(got.post).mockReturnValue({ json } as any)
    const service = new NetcodeV2Service()

    const u1 = makeSbUserId(1)
    const u2 = makeSbUserId(2)
    service.registerPubkey('game-1', u1, PUBKEY)
    service.registerPubkey('game-1', u2, PUBKEY)

    await service.createSessionForGame({
      gameId: 'game-1',
      slots: [
        {
          slot: 0,
          userId: u1,
          observer: false,
          region: makeGameServerRegionId('us-east'),
          rttMs: 20,
        },
        {
          slot: 1,
          userId: u2,
          observer: false,
          region: makeGameServerRegionId('eu-west'),
          rttMs: 40,
        },
      ],
      signal: new AbortController().signal,
    })

    const createCall = asMockedFunction(got.post).mock.calls.find(c =>
      String(c[0]).endsWith('/session/create'),
    )!
    const body = JSON.parse((createCall[1] as any).body)
    // one_way = 20/2 + 90/2 + 40/2 = 10 + 45 + 20 = 75ms.
    expect(body.latency_estimate_ms).toBe(75)
  })

  test('omits latency_estimate_ms entirely when no slot pair carries a latency signal', async () => {
    configureNetcodeV2()
    const json = vi.fn().mockResolvedValue(sessionResponse([0, 1]))
    asMockedFunction(got.post).mockReturnValue({ json } as any)
    const service = new NetcodeV2Service()

    const u1 = makeSbUserId(1)
    const u2 = makeSbUserId(2)
    service.registerPubkey('game-1', u1, PUBKEY)
    service.registerPubkey('game-1', u2, PUBKEY)

    await service.createSessionForGame({
      gameId: 'game-1',
      slots: [
        { slot: 0, userId: u1, observer: false },
        { slot: 1, userId: u2, observer: false },
      ],
      signal: new AbortController().signal,
    })

    const createCall = asMockedFunction(got.post).mock.calls.find(c =>
      String(c[0]).endsWith('/session/create'),
    )!
    const body = JSON.parse((createCall[1] as any).body)
    expect(body).not.toHaveProperty('latency_estimate_ms')
  })

  test('records a home event for the home relay', async () => {
    configureNetcodeV2()
    const json = vi.fn().mockResolvedValue(sessionResponse([0]))
    asMockedFunction(got.post).mockReturnValue({ json } as any)
    const service = new NetcodeV2Service()

    const u1 = makeSbUserId(1)
    service.registerPubkey('game-1', u1, PUBKEY)

    await service.createSessionForGame({
      gameId: 'game-1',
      slots: [{ slot: 0, userId: u1, observer: false }],
      signal: new AbortController().signal,
    })

    expect(addNetcodeV2RelayEvents).toHaveBeenCalledWith('game-1', [
      expect.objectContaining({ kind: 'home', relayId: 1, relayAddr: '10.0.0.1:14900' }),
    ])
  })

  test('records one deduped home event per distinct relay across a dev cross-relay split', async () => {
    configureNetcodeV2()
    // eslint-disable-next-line camelcase
    const secondaryRelay = { relay_id: 2, relay_addr: '10.0.0.2:14900', cert_der: RELAY_CERT_DER }
    const json = vi.fn().mockResolvedValue({
      ...sessionResponse([0, 1, 2]),
      // eslint-disable-next-line camelcase
      slot_homes: [
        { slot: 1, relay: secondaryRelay },
        // A second slot homing on the same secondary relay must not duplicate its home event.
        { slot: 2, relay: secondaryRelay },
      ],
    })
    asMockedFunction(got.post).mockReturnValue({ json } as any)
    const service = new NetcodeV2Service()

    const u1 = makeSbUserId(1)
    const u2 = makeSbUserId(2)
    const u3 = makeSbUserId(3)
    service.registerPubkey('game-1', u1, PUBKEY)
    service.registerPubkey('game-1', u2, PUBKEY)
    service.registerPubkey('game-1', u3, PUBKEY)

    await service.createSessionForGame({
      gameId: 'game-1',
      slots: [
        { slot: 0, userId: u1, observer: false },
        { slot: 1, userId: u2, observer: false },
        { slot: 2, userId: u3, observer: false },
      ],
      signal: new AbortController().signal,
    })

    expect(addNetcodeV2RelayEvents).toHaveBeenCalledTimes(1)
    const [, events] = asMockedFunction(addNetcodeV2RelayEvents).mock.calls[0]
    expect(events).toEqual([
      expect.objectContaining({ kind: 'home', relayId: 1, relayAddr: '10.0.0.1:14900' }),
      expect.objectContaining({ kind: 'home', relayId: 2, relayAddr: '10.0.0.2:14900' }),
    ])
  })

  test('roster entries carry the session home relay and requested region, omitting region when absent', async () => {
    configureNetcodeV2()
    const json = vi.fn().mockResolvedValue(sessionResponse([0, 1]))
    asMockedFunction(got.post).mockReturnValue({ json } as any)
    const service = new NetcodeV2Service()

    const u1 = makeSbUserId(1)
    const u2 = makeSbUserId(2)
    service.registerPubkey('game-1', u1, PUBKEY)
    service.registerPubkey('game-1', u2, PUBKEY)

    const result = await service.createSessionForGame({
      gameId: 'game-1',
      slots: [
        { slot: 0, userId: u1, observer: false, region: makeGameServerRegionId('us-east') },
        { slot: 1, userId: u2, observer: true },
      ],
      signal: new AbortController().signal,
    })

    // The roster is shared by every player's setup, so any player's copy proves the shape.
    const roster = result.get(u1)!.roster
    expect(roster).toEqual([
      { slot: 0, userId: u1, homeRelayId: 1, homeRegion: 'us-east' },
      { slot: 1, userId: u2, homeRelayId: 1 },
    ])
    expect(roster[1]).not.toHaveProperty('homeRegion')
  })

  test('roster entries use their slot_homes override relay for homeRelayId', async () => {
    configureNetcodeV2()
    // eslint-disable-next-line camelcase
    const secondaryRelay = { relay_id: 2, relay_addr: '10.0.0.2:14900', cert_der: RELAY_CERT_DER }
    const json = vi.fn().mockResolvedValue({
      ...sessionResponse([0, 1]),
      // eslint-disable-next-line camelcase
      slot_homes: [{ slot: 1, relay: secondaryRelay }],
    })
    asMockedFunction(got.post).mockReturnValue({ json } as any)
    const service = new NetcodeV2Service()

    const u1 = makeSbUserId(1)
    const u2 = makeSbUserId(2)
    service.registerPubkey('game-1', u1, PUBKEY)
    service.registerPubkey('game-1', u2, PUBKEY)

    const result = await service.createSessionForGame({
      gameId: 'game-1',
      slots: [
        { slot: 0, userId: u1, observer: false },
        { slot: 1, userId: u2, observer: false },
      ],
      signal: new AbortController().signal,
    })

    const roster = result.get(u1)!.roster
    // Slot 0 has no override, so it homes on the session's primary home relay; slot 1's override
    // names the secondary relay instead.
    expect(roster).toEqual([
      { slot: 0, userId: u1, homeRelayId: 1 },
      { slot: 1, userId: u2, homeRelayId: 2 },
    ])
  })
})
