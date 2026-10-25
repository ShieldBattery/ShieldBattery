import got, { HTTPError } from 'got'
import { createPublicKey, sign } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { makeGameServerRegionId } from '../../../common/game-server-regions'
import { asMockedFunction } from '../../../common/testing/mocks'
import { makeSbUserId } from '../../../common/users/sb-user-id'
import type { GameServerRegionsService } from '../game-server-regions/game-server-regions-service'
import {
  addNetcodeV2RelayEvents,
  setNetcodeV2RequestedRegions,
  setNetcodeV2Session,
} from '../games/game-models'
import { getDevelopmentClientUsers } from '../models/permissions'
import { EvidenceSessionMappingService } from './evidence-session-mapping-service'
import {
  checkSessionsAlive,
  clientSigningKeyFromSeedHex,
  NetcodeV2Service,
  NetcodeV2ServiceError,
  relayEndpointToInfo,
} from './netcode-v2-service'
import { SessionReleaseCatalog, SessionReleaseKey } from './session-release-catalog'

// `HTTPError` is kept as the real class (spread from the original module) rather than mocked away,
// since coordinator requests classify failures with `err instanceof HTTPError`.
vi.mock('got', async importOriginal => ({
  ...(await importOriginal<typeof import('got')>()),
  default: {
    post: vi.fn(),
  },
}))

vi.mock('../models/permissions', () => ({ getDevelopmentClientUsers: vi.fn() }))

// The session id, relay history, and requested-region persistence are best-effort DB writes; stub
// them so the create/rehome paths don't reach a real database.
vi.mock('../games/game-models', () => ({
  setNetcodeV2Session: vi.fn().mockResolvedValue(undefined),
  addNetcodeV2RelayEvents: vi.fn().mockResolvedValue(undefined),
  setNetcodeV2RequestedRegions: vi.fn().mockResolvedValue(undefined),
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
  vi.stubEnv('SB_RP2_EVIDENCE_KEYS', undefined)
}

/**
 * Builds a real `HTTPError` instance (so `instanceof HTTPError` checks pass) carrying just the
 * `response.statusCode` the service reads, without constructing got's full internal request/
 * response machinery.
 */
function fakeHttpError(statusCode: number, retryAfter?: string): HTTPError {
  const err = Object.create(HTTPError.prototype) as HTTPError
  Object.assign(err, {
    response: {
      statusCode,
      headers: retryAfter === undefined ? {} : { 'retry-after': retryAfter },
    },
  })
  return err
}

/**
 * A `GameServerRegionsService` double exposing only the getter `NetcodeV2Service` reads, serving
 * `servedRtts` (empty by default, matching an unconfigured or not-yet-measuring coordinator).
 */
function fakeGameServerRegionsService(
  servedRtts: ReadonlyMap<string, number> = new Map(),
): GameServerRegionsService {
  return {
    getBackboneRtts: () => Promise.resolve(servedRtts),
  } as unknown as GameServerRegionsService
}

/** Builds a `NetcodeV2Service` with a served backbone RTT table double, for tests that don't care. */
const persistMapping = vi.fn().mockResolvedValue(undefined)
function makeService(
  servedRtts?: ReadonlyMap<string, number>,
  getKeys: () => readonly SessionReleaseKey[] = () => [],
): NetcodeV2Service {
  return new NetcodeV2Service(
    fakeGameServerRegionsService(servedRtts),
    { persist: persistMapping } as unknown as EvidenceSessionMappingService,
    { getKeys } as SessionReleaseCatalog,
  )
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

describe('netcode-v2/relayEndpointToInfo', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  const FAKE_CONFIG = {
    coordinatorUrl: 'http://coordinator.example',
    tenant: 'sb-dev',
    relayServerName: 'relay.example',
    rollback: false,
    periodicEvidence: false,
  }

  /**
   * Builds a coordinator relay endpoint wire object (the snake_case shape `relayEndpointToInfo`
   * parses) from camelCase args, so individual tests don't each need their own `eslint-disable`
   * for the wire's snake_case field names.
   */
  function coordinatorRelay(args: {
    relayId: number
    addr: string
    addrs?: string[]
    certDer?: number[]
  }) {
    return {
      // eslint-disable-next-line eslint-core/camelcase
      relay_id: args.relayId,
      // eslint-disable-next-line eslint-core/camelcase
      relay_addr: args.addr,
      // eslint-disable-next-line eslint-core/camelcase
      cert_der: args.certDer ?? RELAY_CERT_DER,
      // eslint-disable-next-line eslint-core/camelcase
      ...(args.addrs !== undefined ? { relay_addrs: args.addrs } : {}),
    }
  }

  test('passes every relay_addrs candidate through in order, across families and ports', () => {
    const relay = coordinatorRelay({
      relayId: 1,
      addr: '[2001:db8::1]:14900',
      addrs: ['[2001:db8::1]:14900', '10.0.0.1:14900', '[2001:db8::1]:443', '10.0.0.1:443'],
    })

    const info = relayEndpointToInfo(relay, FAKE_CONFIG)

    expect(info.addrs).toEqual([
      '[2001:db8::1]:14900',
      '10.0.0.1:14900',
      '[2001:db8::1]:443',
      '10.0.0.1:443',
    ])
    expect(info.relayId).toBe(1)
    expect(info.serverName).toBe('relay.example')
  })

  test('falls back to relay_addr when relay_addrs is absent', () => {
    const relay = coordinatorRelay({ relayId: 1, addr: '10.0.0.1:14900' })

    expect(relayEndpointToInfo(relay, FAKE_CONFIG).addrs).toEqual(['10.0.0.1:14900'])
  })

  test('falls back to relay_addr when relay_addrs is an empty list', () => {
    const relay = coordinatorRelay({ relayId: 1, addr: '10.0.0.1:14900', addrs: [] })

    expect(relayEndpointToInfo(relay, FAKE_CONFIG).addrs).toEqual(['10.0.0.1:14900'])
  })

  test('keeps a v6 relay_addr bracketed', () => {
    const relay = coordinatorRelay({ relayId: 1, addr: '[2001:db8::1]:14900' })

    expect(relayEndpointToInfo(relay, FAKE_CONFIG).addrs).toEqual(['[2001:db8::1]:14900'])
  })

  test('throws the same NetcodeV2ServiceError shape when relay_addr itself is malformed', () => {
    const relay = coordinatorRelay({ relayId: 1, addr: 'not-an-address' })

    expect(() => relayEndpointToInfo(relay, FAKE_CONFIG)).toThrow(NetcodeV2ServiceError)
    expect(() => relayEndpointToInfo(relay, FAKE_CONFIG)).toThrow(
      'coordinator returned an unparseable relay address: not-an-address',
    )
  })

  test('throws when a relay_addrs entry is malformed, even with a well-formed relay_addr', () => {
    const relay = coordinatorRelay({
      relayId: 1,
      addr: '10.0.0.1:14900',
      addrs: ['10.0.0.1:14900', 'not-an-address'],
    })

    expect(() => relayEndpointToInfo(relay, FAKE_CONFIG)).toThrow(
      'coordinator returned an unparseable relay address: not-an-address',
    )
  })

  test('throws for an unparseable cert regardless of address parsing', () => {
    const relay = coordinatorRelay({ relayId: 1, addr: '10.0.0.1:14900', certDer: [1, 2, 3] })

    expect(() => relayEndpointToInfo(relay, FAKE_CONFIG)).toThrow(NetcodeV2ServiceError)
    expect(() => relayEndpointToInfo(relay, FAKE_CONFIG)).toThrow(
      'coordinator returned an unparseable cert for relay 1',
    )
  })
})

describe('netcode-v2/NetcodeV2Service#rehomeSession', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.clearAllMocks()
  })

  // Mirrors the coordinator's snake_case CoordinatorRelayEndpoint wire shape.
  // eslint-disable-next-line eslint-core/camelcase
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
    const service = makeService()

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
    const service = makeService()

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
    const service = makeService()

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
    // eslint-disable-next-line eslint-core/camelcase
    const laterTargetRelay = { relay_id: 3, relay_addr: '10.0.0.3:14900', cert_der: RELAY_CERT_DER }
    const json = vi
      .fn()
      .mockResolvedValueOnce({ decision: 'newTarget', relay: newTargetRelay })
      .mockResolvedValueOnce({ decision: 'newTarget', relay: laterTargetRelay })
    asMockedFunction(got.post).mockReturnValue({ json } as any)
    const service = makeService()

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
    const service = makeService()

    await service.rehomeSession('game-1', 42, 7)
    await service.rehomeSession('game-1', 42, 7)

    expect(got.post).toHaveBeenCalledTimes(2)
  })

  test('re-asks the coordinator for a transient unavailable (never cached)', async () => {
    configureNetcodeV2()
    const json = vi.fn().mockResolvedValue({ decision: 'unavailable' })
    asMockedFunction(got.post).mockReturnValue({ json } as any)
    const service = makeService()

    await service.rehomeSession('game-1', 42, 7)
    await service.rehomeSession('game-1', 42, 7)

    expect(got.post).toHaveBeenCalledTimes(2)
  })

  test('a different dead relay on the same session is its own coordinator call', async () => {
    configureNetcodeV2()
    const json = vi.fn().mockResolvedValue({ decision: 'newTarget', relay: newTargetRelay })
    asMockedFunction(got.post).mockReturnValue({ json } as any)
    const service = makeService()

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
    const service = makeService()

    await expect(service.rehomeSession('game-1', 42, 7)).rejects.toThrow(
      'coordinator session rehome failed',
    )
    const r2 = await service.rehomeSession('game-1', 42, 7)

    expect(got.post).toHaveBeenCalledTimes(2)
    expect(r2.decision).toBe('newTarget')
  })
})

describe('netcode-v2/NetcodeV2Service#createSessionForGame', () => {
  beforeEach(() => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.clearAllMocks()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  // eslint-disable-next-line eslint-core/camelcase
  const HOME_RELAY = { relay_id: 1, relay_addr: '10.0.0.1:14900', cert_der: RELAY_CERT_DER }
  /** A well-formed 32-byte pubkey (base64), carried in on each slot. */
  const PUBKEY = Buffer.alloc(32, 7).toString('base64')

  function sessionResponse(slots: number[]) {
    return {
      session: 100,
      // eslint-disable-next-line eslint-core/camelcase
      home_relay: HOME_RELAY,
      tokens: slots.map(slot => ({ slot, token: [slot] })),
      bounds: { min: 2, max: 8 },
    }
  }

  /** A `200` create reply carrying `response` as the session body. */
  function createOk(response: unknown) {
    return { statusCode: 200, body: JSON.stringify(response) }
  }

  /** A `202` create reply asking the caller to re-post after `retryAfterMs`. */
  function createProvisioning(regions: string[], retryAfterMs: number) {
    return {
      statusCode: 202,
      body: JSON.stringify({ status: 'provisioning', regions, retryAfterMs }),
    }
  }

  /** Stubs `got.post` to answer the create POST with a single `200` carrying `response`. */
  function mockSessionResponse(response: unknown) {
    asMockedFunction(got.post).mockResolvedValue(createOk(response) as any)
  }

  test('omits evidence fields without verification keys', async () => {
    configureNetcodeV2()
    mockSessionResponse(sessionResponse([0]))
    await makeService().createSessionForGame({
      seed: 1,
      gameId: 'game-1',
      slots: [{ slot: 0, userId: makeSbUserId(1), observer: false, pubkey: PUBKEY }],
      signal: new AbortController().signal,
    })
    const body = JSON.parse((asMockedFunction(got.post).mock.calls[0][1] as any).body)
    expect(body).not.toHaveProperty('evidence_keys')
    expect(body.players[0]).not.toHaveProperty('require_evidence')
  })

  test('does not create a session before the catalog is ready', async () => {
    configureNetcodeV2()
    vi.stubEnv('SB_RP2_RELEASE_CATALOG', 'releases/catalog.json')
    vi.stubEnv('SB_RP2_RELEASE_ENVIRONMENT', 'dev')
    const catalog = new SessionReleaseCatalog()
    await expect(
      makeService(undefined, () => catalog.getKeys()).createSessionForGame({
        seed: 1,
        gameId: 'game-1',
        slots: [{ slot: 0, userId: makeSbUserId(1), observer: false, pubkey: PUBKEY }],
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow('not been initialized')
    expect(got.post).not.toHaveBeenCalled()
  })

  test('persists development mode only for the authorized requesting player', async () => {
    configureNetcodeV2()
    const developer = makeSbUserId(1)
    const opponent = makeSbUserId(2)
    vi.mocked(getDevelopmentClientUsers).mockResolvedValue(new Set([developer, opponent]))
    mockSessionResponse(sessionResponse([0, 1]))
    await makeService(undefined, () => [
      { keyId: 17, publicKey: 'ab'.repeat(32) },
    ]).createSessionForGame({
      seed: 1,
      gameId: 'game-development',
      slots: [
        { slot: 0, userId: developer, observer: false, pubkey: PUBKEY, developmentClient: true },
        { slot: 1, userId: opponent, observer: false, pubkey: PUBKEY },
      ],
      signal: new AbortController().signal,
    })
    expect(getDevelopmentClientUsers).toHaveBeenCalledExactlyOnceWith([developer])
    expect(persistMapping).toHaveBeenCalledExactlyOnceWith('game-development', 100, [
      expect.objectContaining({ userId: developer, developmentClient: true }),
      expect.not.objectContaining({ developmentClient: true }),
    ])
    expect(setNetcodeV2RequestedRegions).toHaveBeenCalledWith(
      'game-development',
      persistMapping.mock.calls[0][2],
    )
    const body = JSON.parse((vi.mocked(got.post).mock.calls[0][1] as any).body)
    expect(body.players.map((p: any) => p.require_evidence)).toEqual([false, false])
  })

  test('rejects a development session after permission revocation, before contacting relays', async () => {
    configureNetcodeV2()
    vi.mocked(getDevelopmentClientUsers).mockResolvedValue(new Set())
    await expect(
      makeService().createSessionForGame({
        seed: 1,
        gameId: 'game-revoked',
        slots: [
          {
            slot: 0,
            userId: makeSbUserId(1),
            observer: false,
            pubkey: PUBKEY,
            developmentClient: true,
          },
        ],
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow('require permission')
    expect(got.post).not.toHaveBeenCalled()
    expect(persistMapping).not.toHaveBeenCalled()
    expect(setNetcodeV2RequestedRegions).not.toHaveBeenCalled()
  })

  test.each([false, true])(
    'preserves keys and periodic policy (%s) through retries',
    async periodic => {
      vi.useFakeTimers()
      configureNetcodeV2()
      if (periodic) {
        vi.stubEnv('SB_RP2_RELEASE_CATALOG', 'releases/catalog.json')
        vi.stubEnv('SB_RP2_PERIODIC_EVIDENCE', 'true')
      }
      const getKeys = vi
        .fn()
        .mockReturnValueOnce([{ keyId: 17, publicKey: 'ab'.repeat(32) }])
        .mockImplementation(() => {
          throw new Error('catalog read twice')
        })
      asMockedFunction(got.post)
        .mockRejectedValueOnce(fakeHttpError(503, '1'))
        .mockResolvedValueOnce(createOk(sessionResponse([0, 1])) as any)
      const result = makeService(undefined, getKeys).createSessionForGame({
        seed: 1,
        gameId: 'game-1',
        slots: [
          { slot: 0, userId: makeSbUserId(1), observer: false, pubkey: PUBKEY },
          { slot: 1, userId: makeSbUserId(2), observer: true, pubkey: PUBKEY },
        ],
        signal: new AbortController().signal,
      })
      await vi.advanceTimersByTimeAsync(1000)
      await result
      const bodies = asMockedFunction(got.post).mock.calls.map(call => (call[1] as any).body)
      expect(getKeys).toHaveBeenCalledTimes(1)
      expect(bodies).toHaveLength(2)
      expect(bodies[1]).toBe(bodies[0])
      const body = JSON.parse(bodies[0])
      // eslint-disable-next-line eslint-core/camelcase
      expect(body.evidence_keys).toEqual([{ key_id: 17, public_key: Array(32).fill(0xab) }])
      expect(body.periodic_evidence).toBe(periodic || undefined)
      for (const player of body.players) expect(player.require_evidence).toBe(false)
      expect(setNetcodeV2Session).not.toHaveBeenCalled()
      expect(persistMapping).toHaveBeenCalledExactlyOnceWith('game-1', 100, [
        expect.objectContaining({ slot: 0, userId: makeSbUserId(1), observer: false }),
        expect.objectContaining({ slot: 1, userId: makeSbUserId(2), observer: true }),
      ])
    },
  )

  test('forwards each slot region (snake_case) and omits it when absent', async () => {
    configureNetcodeV2()
    mockSessionResponse(sessionResponse([0, 1]))
    const service = makeService()

    const u1 = makeSbUserId(1)
    const u2 = makeSbUserId(2)

    await service.createSessionForGame({
      seed: 0x89abcdef,
      gameId: 'game-1',
      slots: [
        {
          slot: 0,
          userId: u1,
          observer: false,
          region: makeGameServerRegionId('us-east'),
          pubkey: PUBKEY,
        },
        { slot: 1, userId: u2, observer: true, pubkey: PUBKEY },
      ],
      signal: new AbortController().signal,
    })

    const createCall = asMockedFunction(got.post).mock.calls.find(c =>
      String(c[0]).endsWith('/session/create'),
    )!
    const body = JSON.parse((createCall[1] as any).body)
    expect(body.lobby_policy).toEqual({
      allowed: [{ slot: 0, payload: [0x48, 0xef, 0xcd, 0xab, 0x89, 8, 8, 8, 8, 8, 8, 8, 8] }],
    })
    expect(body.players).toEqual([
      expect.objectContaining({ slot: 0, observer: false, region: 'us-east' }),
      expect.objectContaining({ slot: 1, observer: true }),
    ])
    // The region-less slot must not carry the key at all (rather than a null/undefined value).
    expect(body.players[1]).not.toHaveProperty('region')
  })

  test('records what every slot requested, region-less slots included', async () => {
    configureNetcodeV2()
    mockSessionResponse(sessionResponse([0, 1, 2]))
    const service = makeService()

    const u1 = makeSbUserId(1)
    const u2 = makeSbUserId(2)
    const u3 = makeSbUserId(3)

    await service.createSessionForGame({
      seed: 0x89abcdef,
      gameId: 'game-1',
      slots: [
        {
          slot: 0,
          userId: u1,
          observer: false,
          region: makeGameServerRegionId('us-east'),
          rttMs: 24,
          regionManual: true,
          pubkey: PUBKEY,
        },
        {
          slot: 1,
          userId: u2,
          observer: false,
          region: makeGameServerRegionId('eu-west'),
          regionManual: false,
          pubkey: PUBKEY,
        },
        { slot: 2, userId: u3, observer: true, pubkey: PUBKEY },
      ],
      signal: new AbortController().signal,
    })

    expect(setNetcodeV2RequestedRegions).toHaveBeenCalledWith('game-1', [
      { slot: 0, userId: u1, observer: false, region: 'us-east', rttMs: 24, manual: true },
      // A hand-picked region with nothing measured yet is still what the player asked for.
      {
        slot: 1,
        userId: u2,
        observer: false,
        region: 'eu-west',
        rttMs: undefined,
        manual: false,
      },
      // A region-less entry is itself signal: this player queued region-blind.
      {
        slot: 2,
        userId: u3,
        observer: true,
        region: undefined,
        rttMs: undefined,
        manual: undefined,
      },
    ])
  })

  test('records the requested regions even when the coordinator never mints a session', async () => {
    configureNetcodeV2()
    asMockedFunction(got.post).mockRejectedValue(new Error('coordinator unreachable'))
    const service = makeService()

    const u1 = makeSbUserId(1)

    await expect(
      service.createSessionForGame({
        seed: 0x89abcdef,
        gameId: 'game-1',
        slots: [
          {
            slot: 0,
            userId: u1,
            observer: false,
            region: makeGameServerRegionId('us-east'),
            rttMs: 24,
            pubkey: PUBKEY,
          },
        ],
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow()

    // A create that never completes is exactly when the request side of placement matters, so the
    // record has to already be down before the coordinator is asked for anything.
    expect(setNetcodeV2RequestedRegions).toHaveBeenCalledWith('game-1', [
      expect.objectContaining({ slot: 0, userId: u1, region: 'us-east', rttMs: 24 }),
    ])
  })

  test('adds a ceiled latency_estimate_ms to the request body when slots carry a latency signal', async () => {
    configureNetcodeV2()
    mockSessionResponse(sessionResponse([0, 1]))
    const service = makeService()

    const u1 = makeSbUserId(1)
    const u2 = makeSbUserId(2)

    await service.createSessionForGame({
      seed: 0x89abcdef,
      gameId: 'game-1',
      slots: [
        {
          slot: 0,
          userId: u1,
          observer: false,
          pubkey: PUBKEY,
          region: makeGameServerRegionId('us-east'),
          rttMs: 21,
        },
        {
          slot: 1,
          userId: u2,
          observer: false,
          pubkey: PUBKEY,
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
    mockSessionResponse(sessionResponse([0, 1]))
    const service = makeService()

    const u1 = makeSbUserId(1)
    const u2 = makeSbUserId(2)

    await service.createSessionForGame({
      seed: 0x89abcdef,
      gameId: 'game-1',
      slots: [
        {
          slot: 0,
          userId: u1,
          observer: false,
          pubkey: PUBKEY,
          region: makeGameServerRegionId('us-east'),
          rttMs: 20,
        },
        {
          slot: 1,
          userId: u2,
          observer: false,
          pubkey: PUBKEY,
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

  test("uses the game server regions service's served backbone table when no env override names the pair", async () => {
    configureNetcodeV2()
    mockSessionResponse(sessionResponse([0, 1]))
    const service = makeService(new Map([['eu-west|us-east', 90]]))

    const u1 = makeSbUserId(1)
    const u2 = makeSbUserId(2)

    await service.createSessionForGame({
      seed: 0x89abcdef,
      gameId: 'game-1',
      slots: [
        {
          slot: 0,
          userId: u1,
          observer: false,
          pubkey: PUBKEY,
          region: makeGameServerRegionId('us-east'),
          rttMs: 20,
        },
        {
          slot: 1,
          userId: u2,
          observer: false,
          pubkey: PUBKEY,
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
    // one_way = 20/2 + 90/2 + 40/2 = 10 + 45 + 20 = 75ms, same shape as the env-configured case.
    expect(body.latency_estimate_ms).toBe(75)
  })

  test('an env override wins over a served value for the same pair', async () => {
    vi.stubEnv('SB_REGION_BACKBONE_RTT_JSON', JSON.stringify({ 'us-east|eu-west': 10 }))
    configureNetcodeV2()
    mockSessionResponse(sessionResponse([0, 1]))
    const service = makeService(new Map([['eu-west|us-east', 90]]))

    const u1 = makeSbUserId(1)
    const u2 = makeSbUserId(2)

    await service.createSessionForGame({
      seed: 0x89abcdef,
      gameId: 'game-1',
      slots: [
        {
          slot: 0,
          userId: u1,
          observer: false,
          pubkey: PUBKEY,
          region: makeGameServerRegionId('us-east'),
          rttMs: 20,
        },
        {
          slot: 1,
          userId: u2,
          observer: false,
          pubkey: PUBKEY,
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
    // The env override (10) wins over the served value (90): 20/2 + 10/2 + 40/2 = 10 + 5 + 20 = 35ms.
    expect(body.latency_estimate_ms).toBe(35)
  })

  test('omits latency_estimate_ms entirely when no slot pair carries a latency signal', async () => {
    configureNetcodeV2()
    mockSessionResponse(sessionResponse([0, 1]))
    const service = makeService()

    const u1 = makeSbUserId(1)
    const u2 = makeSbUserId(2)

    await service.createSessionForGame({
      seed: 0x89abcdef,
      gameId: 'game-1',
      slots: [
        { slot: 0, userId: u1, observer: false, pubkey: PUBKEY },
        { slot: 1, userId: u2, observer: false, pubkey: PUBKEY },
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
    mockSessionResponse(sessionResponse([0]))
    const service = makeService()

    const u1 = makeSbUserId(1)

    await service.createSessionForGame({
      seed: 0x89abcdef,
      gameId: 'game-1',
      slots: [{ slot: 0, userId: u1, observer: false, pubkey: PUBKEY }],
      signal: new AbortController().signal,
    })

    expect(addNetcodeV2RelayEvents).toHaveBeenCalledWith('game-1', [
      expect.objectContaining({ kind: 'home', relayId: 1, relayAddr: '10.0.0.1:14900' }),
    ])
  })

  test('records the home relay region when the coordinator labels it', async () => {
    configureNetcodeV2()
    mockSessionResponse({
      ...sessionResponse([0]),
      // eslint-disable-next-line eslint-core/camelcase
      relay_regions: [{ relay_id: 1, region: 'us-east' }],
    })
    const service = makeService()

    const u1 = makeSbUserId(1)

    await service.createSessionForGame({
      seed: 0x89abcdef,
      gameId: 'game-1',
      slots: [{ slot: 0, userId: u1, observer: false, pubkey: PUBKEY }],
      signal: new AbortController().signal,
    })

    expect(addNetcodeV2RelayEvents).toHaveBeenCalledWith('game-1', [
      expect.objectContaining({ kind: 'home', relayId: 1, region: 'us-east' }),
    ])
  })

  test('omits the region on a home event when the coordinator has no label for the relay', async () => {
    configureNetcodeV2()
    mockSessionResponse(sessionResponse([0]))
    const service = makeService()

    const u1 = makeSbUserId(1)

    await service.createSessionForGame({
      seed: 0x89abcdef,
      gameId: 'game-1',
      slots: [{ slot: 0, userId: u1, observer: false, pubkey: PUBKEY }],
      signal: new AbortController().signal,
    })

    const [, events] = asMockedFunction(addNetcodeV2RelayEvents).mock.calls[0]
    expect(events[0]).not.toHaveProperty('region')
  })

  test('records one deduped home event per distinct relay across a dev cross-relay split', async () => {
    configureNetcodeV2()
    // eslint-disable-next-line eslint-core/camelcase
    const secondaryRelay = { relay_id: 2, relay_addr: '10.0.0.2:14900', cert_der: RELAY_CERT_DER }
    mockSessionResponse({
      ...sessionResponse([0, 1, 2]),
      // eslint-disable-next-line eslint-core/camelcase
      slot_homes: [
        { slot: 1, relay: secondaryRelay },
        // A second slot homing on the same secondary relay must not duplicate its home event.
        { slot: 2, relay: secondaryRelay },
      ],
    })
    const service = makeService()

    const u1 = makeSbUserId(1)
    const u2 = makeSbUserId(2)
    const u3 = makeSbUserId(3)

    await service.createSessionForGame({
      seed: 0x89abcdef,
      gameId: 'game-1',
      slots: [
        { slot: 0, userId: u1, observer: false, pubkey: PUBKEY },
        { slot: 1, userId: u2, observer: false, pubkey: PUBKEY },
        { slot: 2, userId: u3, observer: false, pubkey: PUBKEY },
      ],
      signal: new AbortController().signal,
    })

    expect(addNetcodeV2RelayEvents).toHaveBeenCalledTimes(1)
    const [, events] = asMockedFunction(addNetcodeV2RelayEvents).mock.calls[0]
    expect(events).toEqual([
      expect.objectContaining({
        kind: 'home',
        relayId: 1,
        relayAddr: '10.0.0.1:14900',
        slots: [0],
      }),
      expect.objectContaining({
        kind: 'home',
        relayId: 2,
        relayAddr: '10.0.0.2:14900',
        slots: [1, 2],
      }),
    ])
  })

  test('keeps the primary home event with no slots when every slot homes elsewhere', async () => {
    configureNetcodeV2()
    // eslint-disable-next-line eslint-core/camelcase
    const secondaryRelay = { relay_id: 2, relay_addr: '10.0.0.2:14900', cert_der: RELAY_CERT_DER }
    mockSessionResponse({
      ...sessionResponse([0, 1]),
      // eslint-disable-next-line eslint-core/camelcase
      slot_homes: [
        { slot: 0, relay: secondaryRelay },
        { slot: 1, relay: secondaryRelay },
      ],
    })
    const service = makeService()

    await service.createSessionForGame({
      seed: 0x89abcdef,
      gameId: 'game-1',
      slots: [
        { slot: 0, userId: makeSbUserId(1), observer: false, pubkey: PUBKEY },
        { slot: 1, userId: makeSbUserId(2), observer: false, pubkey: PUBKEY },
      ],
      signal: new AbortController().signal,
    })

    const [, events] = asMockedFunction(addNetcodeV2RelayEvents).mock.calls[0]
    expect(events).toEqual([
      expect.objectContaining({ kind: 'home', relayId: 1, slots: [] }),
      expect.objectContaining({ kind: 'home', relayId: 2, slots: [0, 1] }),
    ])
  })

  test('roster entries carry a region only on the receiving player’s own slot', async () => {
    configureNetcodeV2()
    mockSessionResponse(sessionResponse([0, 1, 2]))
    const service = makeService()

    const u1 = makeSbUserId(1)
    const u2 = makeSbUserId(2)
    const u3 = makeSbUserId(3)

    const result = await service.createSessionForGame({
      seed: 0x89abcdef,
      gameId: 'game-1',
      slots: [
        {
          slot: 0,
          userId: u1,
          observer: false,
          region: makeGameServerRegionId('us-east'),
          pubkey: PUBKEY,
        },
        {
          slot: 1,
          userId: u2,
          observer: false,
          region: makeGameServerRegionId('kr'),
          pubkey: PUBKEY,
        },
        { slot: 2, userId: u3, observer: true, pubkey: PUBKEY },
      ],
      signal: new AbortController().signal,
    })

    // Each player's roster names other players' regions never, and their own when requested:
    // regions place players geographically, and the handoff arrives before the game starts.
    expect(result.setups.get(u1)!.roster).toEqual([
      { slot: 0, userId: u1, homeRelayId: 1, homeRegion: 'us-east' },
      { slot: 1, userId: u2, homeRelayId: 1 },
      { slot: 2, userId: u3, homeRelayId: 1 },
    ])
    expect(result.setups.get(u2)!.roster).toEqual([
      { slot: 0, userId: u1, homeRelayId: 1 },
      { slot: 1, userId: u2, homeRelayId: 1, homeRegion: 'kr' },
      { slot: 2, userId: u3, homeRelayId: 1 },
    ])
    // A player whose slot requested no region gets none anywhere.
    expect(result.setups.get(u3)!.roster.every(entry => !('homeRegion' in entry))).toBe(true)
  })

  test('roster entries use their slot_homes override relay for homeRelayId', async () => {
    configureNetcodeV2()
    // eslint-disable-next-line eslint-core/camelcase
    const secondaryRelay = { relay_id: 2, relay_addr: '10.0.0.2:14900', cert_der: RELAY_CERT_DER }
    mockSessionResponse({
      ...sessionResponse([0, 1]),
      // eslint-disable-next-line eslint-core/camelcase
      slot_homes: [{ slot: 1, relay: secondaryRelay }],
    })
    const service = makeService()

    const u1 = makeSbUserId(1)
    const u2 = makeSbUserId(2)

    const result = await service.createSessionForGame({
      seed: 0x89abcdef,
      gameId: 'game-1',
      slots: [
        { slot: 0, userId: u1, observer: false, pubkey: PUBKEY },
        { slot: 1, userId: u2, observer: false, pubkey: PUBKEY },
      ],
      signal: new AbortController().signal,
    })

    const roster = result.setups.get(u1)!.roster
    // Slot 0 has no override, so it homes on the session's primary home relay; slot 1's override
    // names the secondary relay instead.
    expect(roster).toEqual([
      { slot: 0, userId: u1, homeRelayId: 1 },
      { slot: 1, userId: u2, homeRelayId: 2 },
    ])
  })

  test('asks for rollback only when configured, and hands every player the granted mode', async () => {
    configureNetcodeV2()
    vi.stubEnv('SB_RP2_ROLLBACK', 'true')
    mockSessionResponse({ ...sessionResponse([0, 1]), rollback: true })
    const service = makeService()

    const u1 = makeSbUserId(1)
    const u2 = makeSbUserId(2)
    const result = await service.createSessionForGame({
      seed: 0x89abcdef,
      gameId: 'game-1',
      slots: [
        { slot: 0, userId: u1, observer: false, pubkey: PUBKEY },
        { slot: 1, userId: u2, observer: false, pubkey: PUBKEY },
      ],
      canRollBack: true,
      signal: new AbortController().signal,
    })

    const createCall = asMockedFunction(got.post).mock.calls.find(c =>
      String(c[0]).endsWith('/session/create'),
    )!
    expect(JSON.parse((createCall[1] as any).body).rollback).toBe(true)
    expect(result.setups.get(u1)!.rollback).toBe(true)
    expect(result.setups.get(u2)!.rollback).toBe(true)
  })

  test('runs lockstep when the coordinator does not grant rollback, or it was never asked', async () => {
    configureNetcodeV2()
    mockSessionResponse(sessionResponse([0]))
    const service = makeService()

    const u1 = makeSbUserId(1)
    const result = await service.createSessionForGame({
      seed: 0x89abcdef,
      gameId: 'game-1',
      slots: [{ slot: 0, userId: u1, observer: false, pubkey: PUBKEY }],
      signal: new AbortController().signal,
    })

    const createCall = asMockedFunction(got.post).mock.calls.find(c =>
      String(c[0]).endsWith('/session/create'),
    )!
    expect(JSON.parse((createCall[1] as any).body)).not.toHaveProperty('rollback')
    expect(result.setups.get(u1)!.rollback).toBe(false)
  })

  test("runs lockstep when rollback is configured but the game can't roll back", async () => {
    configureNetcodeV2()
    vi.stubEnv('SB_RP2_ROLLBACK', 'true')
    mockSessionResponse(sessionResponse([0]))
    const service = makeService()

    const u1 = makeSbUserId(1)
    const result = await service.createSessionForGame({
      seed: 0x89abcdef,
      gameId: 'game-1',
      slots: [{ slot: 0, userId: u1, observer: false, pubkey: PUBKEY }],
      canRollBack: false,
      signal: new AbortController().signal,
    })

    const createCall = asMockedFunction(got.post).mock.calls.find(c =>
      String(c[0]).endsWith('/session/create'),
    )!
    expect(JSON.parse((createCall[1] as any).body)).not.toHaveProperty('rollback')
    expect(result.setups.get(u1)!.rollback).toBe(false)
  })

  test('polls through a 202 provisioning reply and re-posts the identical signed body', async () => {
    vi.useFakeTimers()
    configureNetcodeV2()
    asMockedFunction(got.post)
      .mockResolvedValueOnce(createProvisioning(['us-east'], 2000) as any)
      .mockResolvedValueOnce(createOk(sessionResponse([0])) as any)
    const service = makeService()
    const onProvisioning = vi.fn()

    const u1 = makeSbUserId(1)

    const resultPromise = service.createSessionForGame({
      seed: 0x89abcdef,
      gameId: 'game-1',
      slots: [{ slot: 0, userId: u1, observer: false, pubkey: PUBKEY }],
      signal: new AbortController().signal,
      onProvisioning,
    })
    await vi.advanceTimersByTimeAsync(2100)
    const result = await resultPromise

    expect(got.post).toHaveBeenCalledTimes(2)
    const [firstCall, secondCall] = asMockedFunction(got.post).mock.calls
    // The coordinator's idempotency depends on identical body bytes across attempts.
    expect((secondCall[1] as any).body).toBe((firstCall[1] as any).body)
    // Each attempt is freshly signed.
    expect((firstCall[1] as any).headers['x-rp2-signature']).toMatch(/^[0-9a-f]{128}$/)
    expect((secondCall[1] as any).headers['x-rp2-signature']).toMatch(/^[0-9a-f]{128}$/)
    expect(onProvisioning).toHaveBeenCalledTimes(1)
    expect(onProvisioning).toHaveBeenCalledWith(['us-east'])
    expect(result.setups.get(u1)).toBeDefined()
  })

  function createSinglePlayerSession(
    service: NetcodeV2Service,
    signal = new AbortController().signal,
    onProvisioning?: (regions: string[]) => void,
    gameId = 'game-1',
  ) {
    return service.createSessionForGame({
      seed: 0x89abcdef,
      gameId,
      slots: [{ slot: 0, userId: makeSbUserId(1), observer: false, pubkey: PUBKEY }],
      signal,
      onProvisioning,
    })
  }

  test('retries a 503 with identical body bytes and a fresh signature, then persists once', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_700_000_000_000)
    configureNetcodeV2()
    asMockedFunction(got.post)
      .mockRejectedValueOnce(fakeHttpError(503, '0'))
      .mockResolvedValueOnce(createOk(sessionResponse([0])) as any)
    const onProvisioning = vi.fn()
    const resultPromise = createSinglePlayerSession(makeService(), undefined, onProvisioning)

    await vi.advanceTimersByTimeAsync(999)
    expect(got.post).toHaveBeenCalledTimes(1)
    expect(setNetcodeV2Session).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect((await resultPromise).session).toBe(100)

    const attempts = asMockedFunction(got.post).mock.calls.map(([, options]) => options as any)
    expect(attempts).toHaveLength(2)
    expect(attempts[1].body).toBe(attempts[0].body)
    expect(JSON.parse(attempts[0].body).external_id).toBe('game-1')
    expect(attempts[1].headers['x-rp2-timestamp']).toBe('1700000001')
    expect(attempts[1].headers['x-rp2-signature']).not.toBe(attempts[0].headers['x-rp2-signature'])
    for (const attempt of attempts) {
      expect(attempt.retry).toEqual({ limit: 0 })
      const message =
        `rp2-request-v1:${attempt.headers['x-rp2-timestamp']}:POST:/session/create:` + attempt.body
      expect(attempt.headers['x-rp2-signature']).toBe(
        sign(
          null,
          Buffer.from(message),
          clientSigningKeyFromSeedHex(TEST_CLIENT_SEED_HEX),
        ).toString('hex'),
      )
    }
    expect(onProvisioning).not.toHaveBeenCalled()
    expect(setNetcodeV2Session).toHaveBeenCalledExactlyOnceWith('game-1', 100)
    expect(addNetcodeV2RelayEvents).toHaveBeenCalledTimes(1)
    expect(setNetcodeV2RequestedRegions).toHaveBeenCalledTimes(1)
  })

  test.each([
    { retryAfter: '0', delayMs: 1125 },
    { retryAfter: '3', delayMs: 3125 },
  ])(
    'adds jitter after the Retry-After/backoff floor ($retryAfter seconds)',
    async ({ retryAfter, delayMs }) => {
      vi.useFakeTimers()
      configureNetcodeV2()
      vi.mocked(Math.random).mockReturnValue(0.5)
      asMockedFunction(got.post)
        .mockRejectedValueOnce(fakeHttpError(503, retryAfter))
        .mockResolvedValueOnce(createOk(sessionResponse([0])) as any)
      const resultPromise = createSinglePlayerSession(makeService())

      await vi.advanceTimersByTimeAsync(delayMs - 1)
      expect(got.post).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(1)
      await resultPromise
      expect(got.post).toHaveBeenCalledTimes(2)
    },
  )

  test('backs off repeated marked 503 replies up to ten seconds', async () => {
    vi.useFakeTimers()
    configureNetcodeV2()
    asMockedFunction(got.post)
      .mockRejectedValueOnce(fakeHttpError(503, '0'))
      .mockRejectedValueOnce(fakeHttpError(503, '0'))
      .mockRejectedValueOnce(fakeHttpError(503, '0'))
      .mockRejectedValueOnce(fakeHttpError(503, '0'))
      .mockRejectedValueOnce(fakeHttpError(503, '0'))
      .mockRejectedValueOnce(fakeHttpError(503, '0'))
      .mockResolvedValueOnce(createOk(sessionResponse([0])) as any)
    const resultPromise = createSinglePlayerSession(makeService())

    let attempts = 1
    for (const delayMs of [1000, 2000, 4000, 8000, 10_000, 10_000]) {
      await vi.advanceTimersByTimeAsync(delayMs - 1)
      expect(got.post).toHaveBeenCalledTimes(attempts)
      await vi.advanceTimersByTimeAsync(1)
      ++attempts
      expect(got.post).toHaveBeenCalledTimes(attempts)
    }
    await resultPromise
  })

  test('expires without retrying early when Retry-After exceeds the whole budget', async () => {
    vi.useFakeTimers()
    configureNetcodeV2()
    asMockedFunction(got.post).mockRejectedValue(fakeHttpError(503, '180'))
    const resultPromise = createSinglePlayerSession(makeService())
    const rejected = (async () => {
      await expect(resultPromise).rejects.toThrow('coordinator session create failed')
    })()

    await vi.advanceTimersByTimeAsync(119_999)
    expect(got.post).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    await rejected
    await vi.advanceTimersByTimeAsync(60_000)
    expect(got.post).toHaveBeenCalledTimes(1)
    expect(setNetcodeV2Session).not.toHaveBeenCalled()
  })

  test('handles mixed provisioning and 503 replies without duplicating the provisioning notice', async () => {
    vi.useFakeTimers()
    configureNetcodeV2()
    asMockedFunction(got.post)
      .mockRejectedValueOnce(fakeHttpError(503, '0'))
      .mockResolvedValueOnce(createProvisioning(['us-east'], 2000) as any)
      .mockRejectedValueOnce(fakeHttpError(503, '0'))
      .mockResolvedValueOnce(createProvisioning(['us-east'], 1000) as any)
      .mockResolvedValueOnce(createOk(sessionResponse([0])) as any)
    const onProvisioning = vi.fn()
    const resultPromise = createSinglePlayerSession(makeService(), undefined, onProvisioning)

    await vi.advanceTimersByTimeAsync(6000)
    await resultPromise

    const bodies = asMockedFunction(got.post).mock.calls.map(([, options]) => (options as any).body)
    expect(bodies).toHaveLength(5)
    expect(new Set(bodies).size).toBe(1)
    expect(onProvisioning).toHaveBeenCalledExactlyOnceWith(['us-east'])
    expect(setNetcodeV2Session).toHaveBeenCalledTimes(1)
  })

  test.each([0, -3_600_000, 3_600_000])(
    'bounds 503 retries by elapsed time despite a wall-clock adjustment of %i ms',
    async clockChangeMs => {
      vi.useFakeTimers()
      configureNetcodeV2()
      asMockedFunction(got.post).mockRejectedValue(fakeHttpError(503, '0'))
      const resultPromise = createSinglePlayerSession(makeService())
      const rejected = (async () => {
        await expect(resultPromise).rejects.toThrow('coordinator session create failed')
      })()

      await vi.advanceTimersByTimeAsync(10_000)
      vi.setSystemTime(Date.now() + clockChangeMs)
      await vi.advanceTimersByTimeAsync(109_999)
      expect(got.post).toHaveBeenCalledTimes(15)
      const attempts = asMockedFunction(got.post).mock.calls.map(([, options]) => options as any)
      expect(attempts[0].timeout).toEqual({ request: 10_000 })
      expect(attempts.at(-1).timeout).toEqual({ request: 5000 })
      await vi.advanceTimersByTimeAsync(1)
      await rejected
      await vi.advanceTimersByTimeAsync(10_000)
      expect(got.post).toHaveBeenCalledTimes(15)
      expect(setNetcodeV2Session).not.toHaveBeenCalled()
    },
  )

  test('a 503 does not reset the provisioning deadline or sleep beyond it', async () => {
    vi.useFakeTimers()
    configureNetcodeV2()
    asMockedFunction(got.post)
      .mockResolvedValueOnce(createProvisioning(['us-east'], 9500) as any)
      .mockRejectedValue(fakeHttpError(503, '0'))
    const resultPromise = createSinglePlayerSession(makeService())
    const rejected = (async () => {
      await expect(resultPromise).rejects.toThrow('coordinator session create failed')
    })()

    await vi.advanceTimersByTimeAsync(119_999)
    expect(got.post).toHaveBeenCalledTimes(15)
    const lastAttempt = asMockedFunction(got.post).mock.calls.at(-1)![1] as any
    expect(lastAttempt.timeout).toEqual({ request: 5500 })
    await vi.advanceTimersByTimeAsync(1)
    await rejected
    expect(got.post).toHaveBeenCalledTimes(15)
  })

  test('aborts during a 503 retry delay without sending another POST', async () => {
    vi.useFakeTimers()
    configureNetcodeV2()
    asMockedFunction(got.post).mockRejectedValue(fakeHttpError(503, '0'))
    const controller = new AbortController()
    const resultPromise = createSinglePlayerSession(makeService(), controller.signal)
    const rejected = (async () => {
      await expect(resultPromise).rejects.toThrow('coordinator session create failed')
    })()

    await vi.advanceTimersByTimeAsync(500)
    expect(got.post).toHaveBeenCalledTimes(1)
    controller.abort()
    await rejected
    await vi.advanceTimersByTimeAsync(10_000)
    expect(got.post).toHaveBeenCalledTimes(1)
    expect(setNetcodeV2Session).not.toHaveBeenCalled()
  })

  test.each([400, 401, 409, 500, 502, 504, 'network'])(
    'does not retry a non-503 error (%s)',
    async failure => {
      vi.useFakeTimers()
      configureNetcodeV2()
      const error =
        typeof failure === 'string' ? new Error('connection reset') : fakeHttpError(failure, '0')
      asMockedFunction(got.post).mockRejectedValue(error)

      await expect(createSinglePlayerSession(makeService())).rejects.toMatchObject({ cause: error })
      await vi.advanceTimersByTimeAsync(10_000)
      expect(got.post).toHaveBeenCalledTimes(1)
      expect(setNetcodeV2Session).not.toHaveBeenCalled()
    },
  )

  test.each([
    undefined,
    '',
    '-1',
    '1.5',
    'NaN',
    'Infinity',
    '1e3',
    '1junk',
    'Wed, 21 Oct 2026 12:00:00 GMT',
    '9'.repeat(400),
  ])('does not retry 503 without a valid Retry-After delay (%s)', async retryAfter => {
    vi.useFakeTimers()
    configureNetcodeV2()
    const error = fakeHttpError(503, retryAfter)
    asMockedFunction(got.post).mockRejectedValue(error)

    await expect(createSinglePlayerSession(makeService())).rejects.toMatchObject({ cause: error })
    await vi.advanceTimersByTimeAsync(10_000)
    expect(got.post).toHaveBeenCalledTimes(1)
    expect(setNetcodeV2Session).not.toHaveBeenCalled()
  })

  test('does not retry a marked 503 without a usable external id', async () => {
    vi.useFakeTimers()
    configureNetcodeV2()
    const error = fakeHttpError(503, '0')
    asMockedFunction(got.post).mockRejectedValue(error)

    await expect(
      createSinglePlayerSession(makeService(), undefined, undefined, ''),
    ).rejects.toMatchObject({ cause: error })
    await vi.advanceTimersByTimeAsync(10_000)
    expect(got.post).toHaveBeenCalledTimes(1)
  })

  test('announces provisioning only once across repeated 202 replies', async () => {
    vi.useFakeTimers()
    configureNetcodeV2()
    asMockedFunction(got.post)
      .mockResolvedValueOnce(createProvisioning(['us-east'], 1000) as any)
      .mockResolvedValueOnce(createProvisioning(['us-east'], 1000) as any)
      .mockResolvedValueOnce(createOk(sessionResponse([0])) as any)
    const service = makeService()
    const onProvisioning = vi.fn()

    const u1 = makeSbUserId(1)

    const resultPromise = service.createSessionForGame({
      seed: 0x89abcdef,
      gameId: 'game-1',
      slots: [{ slot: 0, userId: u1, observer: false, pubkey: PUBKEY }],
      signal: new AbortController().signal,
      onProvisioning,
    })
    await vi.advanceTimersByTimeAsync(3000)
    await resultPromise

    expect(got.post).toHaveBeenCalledTimes(3)
    expect(onProvisioning).toHaveBeenCalledTimes(1)
  })

  test('aborting mid-poll ends the create with a create failure', async () => {
    vi.useFakeTimers()
    configureNetcodeV2()
    asMockedFunction(got.post).mockResolvedValue(createProvisioning(['us-east'], 5000) as any)
    const service = makeService()
    const controller = new AbortController()

    const u1 = makeSbUserId(1)

    const resultPromise = service.createSessionForGame({
      seed: 0x89abcdef,
      gameId: 'game-1',
      slots: [{ slot: 0, userId: u1, observer: false, pubkey: PUBKEY }],
      signal: controller.signal,
    })

    // The first POST returns 202; abort while the retry wait is still counting down.
    await vi.advanceTimersByTimeAsync(1000)
    controller.abort()

    await expect(resultPromise).rejects.toThrow('coordinator session create failed')
  })

  test('gives up with a create failure once the provisioning poll ceiling is exceeded', async () => {
    vi.useFakeTimers()
    configureNetcodeV2()
    // The coordinator never stops provisioning, so only the poll ceiling can end the loop.
    asMockedFunction(got.post).mockResolvedValue(createProvisioning(['us-east'], 10_000) as any)
    const service = makeService()

    const u1 = makeSbUserId(1)

    const resultPromise = service.createSessionForGame({
      seed: 0x89abcdef,
      gameId: 'game-1',
      slots: [{ slot: 0, userId: u1, observer: false, pubkey: PUBKEY }],
      signal: new AbortController().signal,
    })

    // The rejection lands while the poll runs out its ceiling, so attach the expectation before
    // advancing rather than leaving the rejection briefly unhandled.
    await Promise.all([
      expect(resultPromise).rejects.toThrow('coordinator session create failed'),
      vi.advanceTimersByTimeAsync(130_000),
    ])
  })

  test("each recipient's setup carries the exact pubkey the server embedded for their own slot", async () => {
    configureNetcodeV2()
    mockSessionResponse(sessionResponse([0, 1]))
    const service = makeService()

    const u1 = makeSbUserId(1)
    const u2 = makeSbUserId(2)
    const pubkey1 = Buffer.alloc(32, 1).toString('base64')
    const pubkey2 = Buffer.alloc(32, 2).toString('base64')

    const result = await service.createSessionForGame({
      seed: 0x89abcdef,
      gameId: 'game-1',
      slots: [
        { slot: 0, userId: u1, observer: false, pubkey: pubkey1 },
        { slot: 1, userId: u2, observer: false, pubkey: pubkey2 },
      ],
      signal: new AbortController().signal,
    })

    // Each recipient's own setup must echo the pubkey the *server* used for their slot, not some
    // other participant's -- otherwise the app can't disambiguate which of its outstanding keypairs
    // the server actually seated.
    expect(result.setups.get(u1)!.clientPubkey).toBe(pubkey1)
    expect(result.setups.get(u2)!.clientPubkey).toBe(pubkey2)
  })

  test('fails fast (never contacting the coordinator) when a slot is missing its pubkey', async () => {
    configureNetcodeV2()
    mockSessionResponse(sessionResponse([0, 1]))
    const service = makeService()

    const u1 = makeSbUserId(1)
    const u2 = makeSbUserId(2)

    await expect(
      service.createSessionForGame({
        seed: 0x89abcdef,
        gameId: 'game-1',
        slots: [
          { slot: 0, userId: u1, observer: false, pubkey: PUBKEY },
          // Slot 1's join-time pubkey never arrived; the whole create must fail rather than wait.
          { slot: 1, userId: u2, observer: false },
        ],
        signal: new AbortController().signal,
      }),
    ).rejects.toBeInstanceOf(NetcodeV2ServiceError)

    expect(got.post).not.toHaveBeenCalled()
  })

  test('returns the coordinator session id alongside the per-player setups', async () => {
    configureNetcodeV2()
    mockSessionResponse(sessionResponse([0, 1]))
    const service = makeService()

    const u1 = makeSbUserId(1)
    const u2 = makeSbUserId(2)

    const result = await service.createSessionForGame({
      seed: 0x89abcdef,
      gameId: 'game-1',
      slots: [
        { slot: 0, userId: u1, observer: false, pubkey: PUBKEY },
        { slot: 1, userId: u2, observer: false, pubkey: PUBKEY },
      ],
      signal: new AbortController().signal,
    })

    // The caller needs the session in hand to ask the coordinator about it later, so it has to come
    // back from the create rather than only being persisted.
    expect(result.session).toBe(100)
    expect(result.setups.size).toBe(2)
  })
})

describe('netcode-v2/NetcodeV2Service#fetchSessionLoadState', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.clearAllMocks()
  })

  test('throws when netcode v2 is not configured', async () => {
    const service = makeService()

    await expect(service.fetchSessionLoadState(42)).rejects.toThrow('netcode v2 is not configured')
    expect(got.post).not.toHaveBeenCalled()
  })

  test('posts the tenant + session (as a signed body) and returns the load state', async () => {
    configureNetcodeV2()
    const json = vi.fn().mockResolvedValue({
      known: true,
      setupFinal: true,
      lobbyViolationSlots: [1],
      startedAtMs: 1700000000000,
      connectedSlots: [0, 1],
      startedSlots: [0],
    })
    asMockedFunction(got.post).mockReturnValue({ json } as any)
    const service = makeService()

    const signal = new AbortController().signal
    const result = await service.fetchSessionLoadState(42, {
      timeoutMs: 4000,
      signal,
      settleLobby: true,
    })

    expect(got.post).toHaveBeenCalledWith(
      'http://coordinator.example/session/load-state',
      expect.objectContaining({
        body: JSON.stringify({ tenant: 'sb-dev', session: 42, settleLobby: true }),
        timeout: { request: 4000 },
        signal,
        headers: expect.objectContaining({
          'content-type': 'application/json',
          'x-rp2-timestamp': expect.stringMatching(/^\d+$/),
          'x-rp2-signature': expect.stringMatching(/^[0-9a-f]{128}$/),
        }),
      }),
    )
    expect(result).toEqual({
      evidence: [],
      known: true,
      setupFinal: true,
      lobbyViolationSlots: [1],
      startedAtMs: 1700000000000,
      connectedSlots: [0, 1],
      startedSlots: [0],
      forwardedSlots: [],
      turnsKnown: false,
    })
  })

  test('normalizes a response with no slot lists into empty ones', async () => {
    configureNetcodeV2()
    const json = vi.fn().mockResolvedValue({ known: false })
    asMockedFunction(got.post).mockReturnValue({ json } as any)
    const service = makeService()

    const result = await service.fetchSessionLoadState(42)

    expect(result).toEqual({
      evidence: [],
      known: false,
      setupFinal: false,
      lobbyViolationSlots: [],
      startedAtMs: undefined,
      connectedSlots: [],
      startedSlots: [],
      forwardedSlots: [],
      turnsKnown: false,
    })
  })

  test('keeps the slot lists of a session the coordinator holds but cannot vouch for', async () => {
    configureNetcodeV2()
    const json = vi.fn().mockResolvedValue({
      known: false,
      startedAtMs: 1700000000000,
      connectedSlots: [0, 1],
      startedSlots: [1],
    })
    asMockedFunction(got.post).mockReturnValue({ json } as any)
    const service = makeService()

    const result = await service.fetchSessionLoadState(42)

    // What the coordinator did see happened, whether or not it can promise it saw everything.
    expect(result).toEqual({
      evidence: [],
      known: false,
      setupFinal: false,
      lobbyViolationSlots: [],
      startedAtMs: 1700000000000,
      connectedSlots: [0, 1],
      startedSlots: [1],
      forwardedSlots: [],
      turnsKnown: false,
    })
  })

  test('returns the forwarded slots a coordinator reports and whether it vouches for them', async () => {
    configureNetcodeV2()
    const json = vi.fn().mockResolvedValueOnce({
      known: true,
      startedSlots: [0, 1],
      forwardedSlots: [1],
      turnsKnown: true,
    })
    asMockedFunction(got.post).mockReturnValue({ json } as any)
    const service = makeService()

    const state = await service.fetchSessionLoadState(42)
    expect(state.forwardedSlots).toEqual([1])
    expect(state.turnsKnown).toBe(true)
  })

  test("reads turn evidence as unvouched when the coordinator doesn't report it", async () => {
    configureNetcodeV2()
    const json = vi.fn().mockResolvedValueOnce({ known: true, startedSlots: [0] })
    asMockedFunction(got.post).mockReturnValue({ json } as any)
    const service = makeService()

    const state = await service.fetchSessionLoadState(42)
    expect(state.forwardedSlots).toEqual([])
    expect(state.turnsKnown).toBe(false)
  })

  test('keeps authenticated observations even when load-state is incomplete', async () => {
    configureNetcodeV2()
    const evidence = [
      {
        slot: 0,
        observation: {
          connectionId: Buffer.alloc(32, 1).toString('base64'),
          sequence: 1,
          assignmentRevision: 1,
          verdict: 'valid',
          keyId: 17,
          body: Buffer.from('opaque').toString('base64'),
        },
      },
    ]
    const json = vi.fn().mockResolvedValue({ known: false, connectedSlots: [0], evidence })
    asMockedFunction(got.post).mockReturnValue({ json } as any)
    expect(await makeService().fetchSessionLoadState(42)).toMatchObject({
      known: false,
      connectedSlots: [0],
      evidence,
    })
  })

  test.each([null, {}, [{ slot: 0, observation: {} }], Array(17).fill({})])(
    'drops malformed observations without affecting load-state: %j',
    async evidence => {
      configureNetcodeV2()
      const json = vi.fn().mockResolvedValue({
        known: true,
        connectedSlots: [0],
        lobbyViolationSlots: [1],
        evidence,
      })
      asMockedFunction(got.post).mockReturnValue({ json } as any)
      expect(await makeService().fetchSessionLoadState(42)).toMatchObject({
        known: true,
        connectedSlots: [0],
        lobbyViolationSlots: [1],
        evidence: [],
      })
    },
  )

  test('propagates a request failure', async () => {
    configureNetcodeV2()
    asMockedFunction(got.post).mockImplementation(() => {
      throw new Error('coordinator down')
    })
    const service = makeService()

    await expect(service.fetchSessionLoadState(42)).rejects.toThrow(
      'coordinator session load-state fetch failed',
    )
  })
})

describe('netcode-v2/NetcodeV2Service#warmRegions', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  const R1 = makeGameServerRegionId('us-east')
  const R2 = makeGameServerRegionId('eu-west')

  function mockWarmOk() {
    const json = vi.fn().mockResolvedValue({ warmed: [], unknown: [] })
    asMockedFunction(got.post).mockReturnValue({ json } as any)
  }

  test('is a no-op when the service is disabled', () => {
    const service = makeService()

    service.warmRegions([R1])

    expect(got.post).not.toHaveBeenCalled()
  })

  test('batches multiple regions into a single signed POST', () => {
    configureNetcodeV2()
    mockWarmOk()
    const service = makeService()

    service.warmRegions([R1, R2])

    expect(got.post).toHaveBeenCalledTimes(1)
    const [url, options] = asMockedFunction(got.post).mock.calls[0]
    expect(url).toBe('http://coordinator.example/regions/warm')
    expect(JSON.parse((options as any).body)).toEqual({
      tenant: 'sb-dev',
      regions: ['us-east', 'eu-west'],
    })
    expect((options as any).headers).toEqual(
      expect.objectContaining({
        'content-type': 'application/json',
        'x-rp2-timestamp': expect.stringMatching(/^\d+$/),
        'x-rp2-signature': expect.stringMatching(/^[0-9a-f]{128}$/),
      }),
    )
  })

  test('debounces a region posted again within the window', () => {
    vi.useFakeTimers()
    configureNetcodeV2()
    mockWarmOk()
    const service = makeService()

    service.warmRegions([R1])
    service.warmRegions([R1])

    expect(got.post).toHaveBeenCalledTimes(1)
  })

  test('re-posts a region after the debounce window elapses', () => {
    vi.useFakeTimers()
    configureNetcodeV2()
    mockWarmOk()
    const service = makeService()

    service.warmRegions([R1])
    vi.advanceTimersByTime(30_000)
    service.warmRegions([R1])

    expect(got.post).toHaveBeenCalledTimes(2)
  })

  test('swallows a failed warm request but still holds the debounce', async () => {
    vi.useFakeTimers()
    configureNetcodeV2()
    const json = vi.fn().mockRejectedValue(new Error('coordinator down'))
    asMockedFunction(got.post).mockReturnValue({ json } as any)
    const service = makeService()

    expect(() => service.warmRegions([R1])).not.toThrow()
    await vi.advanceTimersByTimeAsync(0)
    // A second call inside the window is still debounced even though the first POST failed — the
    // stamp is set when the request is dispatched, not on its success.
    service.warmRegions([R1])

    expect(got.post).toHaveBeenCalledTimes(1)
  })
})

describe('netcode-v2/NetcodeV2Service#listFlightBlobs', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.clearAllMocks()
  })

  test('throws when netcode v2 is not configured', async () => {
    const service = makeService()

    await expect(service.listFlightBlobs(42)).rejects.toThrow('netcode v2 is not configured')
    expect(got.post).not.toHaveBeenCalled()
  })

  test('posts the tenant + session (as a signed body) and returns the blob metadata', async () => {
    configureNetcodeV2()
    const stored = [
      { relayId: 7, pinned: true, size: 4096, lastModifiedMs: 1700000000000 },
      { relayId: 9, pinned: false, size: 2048, lastModifiedMs: 1700000060000 },
    ]
    // The extra field checks that unknown coordinator-side additions are dropped by the
    // field-by-field mapping rather than leaking through into our API surface.
    const json = vi.fn().mockResolvedValue({
      blobs: stored.map(b => ({ ...b, checksum: 'not-part-of-our-api' })),
    })
    asMockedFunction(got.post).mockReturnValue({ json } as any)
    const service = makeService()

    const result = await service.listFlightBlobs(42)

    expect(got.post).toHaveBeenCalledWith(
      'http://coordinator.example/flight/blobs',
      expect.objectContaining({
        body: JSON.stringify({ tenant: 'sb-dev', session: 42 }),
        headers: expect.objectContaining({
          'content-type': 'application/json',
          'x-rp2-timestamp': expect.stringMatching(/^\d+$/),
          'x-rp2-signature': expect.stringMatching(/^[0-9a-f]{128}$/),
        }),
      }),
    )
    expect(result).toEqual(stored)
  })

  test('propagates a request failure', async () => {
    configureNetcodeV2()
    asMockedFunction(got.post).mockImplementation(() => {
      throw new Error('coordinator down')
    })
    const service = makeService()

    await expect(service.listFlightBlobs(42)).rejects.toThrow(
      'coordinator flight blob listing failed',
    )
  })
})

describe('netcode-v2/NetcodeV2Service#fetchFlightBlob', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.clearAllMocks()
  })

  test('throws when netcode v2 is not configured', async () => {
    const service = makeService()

    await expect(service.fetchFlightBlob(42, 7)).rejects.toThrow('netcode v2 is not configured')
    expect(got.post).not.toHaveBeenCalled()
  })

  test('posts the tenant + session + relay_id (as a signed body) and returns the recording text', async () => {
    configureNetcodeV2()
    const recording = { events: ['connect', 'leave'] }
    asMockedFunction(got.post).mockResolvedValue({
      statusCode: 200,
      body: JSON.stringify(recording),
    } as any)
    const service = makeService()

    const result = await service.fetchFlightBlob(42, 7)

    expect(got.post).toHaveBeenCalledWith(
      'http://coordinator.example/flight/blob',
      expect.objectContaining({
        // eslint-disable-next-line eslint-core/camelcase
        body: JSON.stringify({ tenant: 'sb-dev', session: 42, relay_id: 7 }),
        headers: expect.objectContaining({
          'content-type': 'application/json',
          'x-rp2-timestamp': expect.stringMatching(/^\d+$/),
          'x-rp2-signature': expect.stringMatching(/^[0-9a-f]{128}$/),
        }),
      }),
    )
    expect(result).toBe(JSON.stringify(recording))
  })

  test('returns undefined when the coordinator has no blob for that relay (a 404)', async () => {
    configureNetcodeV2()
    asMockedFunction(got.post).mockRejectedValue(fakeHttpError(404))
    const service = makeService()

    const result = await service.fetchFlightBlob(42, 7)

    expect(result).toBeUndefined()
  })

  test('propagates a non-404 request failure', async () => {
    configureNetcodeV2()
    asMockedFunction(got.post).mockRejectedValue(fakeHttpError(500))
    const service = makeService()

    await expect(service.fetchFlightBlob(42, 7)).rejects.toThrow(
      'coordinator flight blob fetch failed',
    )
  })
})

describe('netcode-v2/NetcodeV2Service#fetchSessionEvidence', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.clearAllMocks()
  })

  test('uses the signed cached endpoint without load-state or settlement', async () => {
    configureNetcodeV2()
    const evidence = [
      {
        slot: 0,
        observation: {
          connectionId: Buffer.alloc(32, 1).toString('base64'),
          sequence: 1,
          assignmentRevision: 1,
          verdict: 'valid',
          keyId: 17,
          body: Buffer.from('opaque').toString('base64'),
        },
      },
    ]
    asMockedFunction(got.post).mockReturnValue({
      json: vi.fn().mockResolvedValue({ evidence }),
    } as any)
    expect(await makeService().fetchSessionEvidence(42)).toEqual(evidence)
    expect(got.post).toHaveBeenCalledExactlyOnceWith(
      'http://coordinator.example/session/evidence',
      expect.objectContaining({
        body: JSON.stringify({ tenant: 'sb-dev', session: 42 }),
        timeout: { request: 6000 },
        retry: { limit: 0 },
        headers: expect.objectContaining({
          'x-rp2-signature': expect.stringMatching(/^[0-9a-f]{128}$/),
        }),
      }),
    )
  })

  test('retains known samples when one recovery entry uses a future interruption', async () => {
    configureNetcodeV2()
    const known = {
      slot: 0,
      observedAtMs: 123,
      historical: true,
      failureCount: 4,
      observation: {
        connectionId: Buffer.alloc(32, 1).toString('base64'),
        sampleId: 2,
        sequence: 3,
        assignmentRevision: 1,
        verdict: 'missing',
        body: '',
        interruption: 'timeout',
      },
    }
    const future = {
      ...known,
      observation: { ...known.observation, interruption: 'future_reason' },
    }
    asMockedFunction(got.post).mockReturnValue({
      json: vi.fn().mockResolvedValue({ evidence: [{}, future, known] }),
    } as any)
    expect(await makeService().fetchSessionEvidence(42)).toEqual([known])
  })

  test('reports an older coordinator without retrying or falling back', async () => {
    configureNetcodeV2()
    asMockedFunction(got.post).mockReturnValue({
      json: vi.fn().mockRejectedValue(fakeHttpError(404)),
    } as any)
    expect(await makeService().fetchSessionEvidence(42)).toBeUndefined()
    expect(got.post).toHaveBeenCalledTimes(1)
  })

  test.each([429, 503])('propagates a %s failure', async status => {
    configureNetcodeV2()
    asMockedFunction(got.post).mockReturnValue({
      json: vi.fn().mockRejectedValue(fakeHttpError(status)),
    } as any)
    await expect(makeService().fetchSessionEvidence(42)).rejects.toThrow(
      'coordinator session evidence fetch failed',
    )
    expect(got.post).toHaveBeenCalledTimes(1)
  })

  test.each([undefined, [], null, [{}]])(
    'normalizes absent or malformed observations: %j',
    async evidence => {
      configureNetcodeV2()
      asMockedFunction(got.post).mockReturnValue({
        json: vi.fn().mockResolvedValue({ evidence }),
      } as any)
      expect(await makeService().fetchSessionEvidence(42)).toEqual([])
    },
  )
})
