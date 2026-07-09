import got from 'got'
import { createPublicKey, sign } from 'node:crypto'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { asMockedFunction } from '../../../common/testing/mocks'
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

/** A valid `SB_RP2_CLIENT_KEY` fixture (64 hex chars = a 32-byte Ed25519 seed). */
const TEST_CLIENT_SEED_HEX = '11'.repeat(32)

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

  // A valid self-signed DER cert (as the coordinator's byte-array JSON), so a `newTarget` decode
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

    const p1 = service.rehomeSession(42, 7)
    const p2 = service.rehomeSession(42, 7)
    resolveJson({ decision: 'newTarget', relay: newTargetRelay })
    const [r1, r2] = await Promise.all([p1, p2])

    expect(got.post).toHaveBeenCalledTimes(1)
    expect(r1.decision).toBe('newTarget')
    expect(r2).toEqual(r1)
  })

  test('serves a later survivor a cached newTarget without a second coordinator call', async () => {
    configureNetcodeV2()
    const json = vi.fn().mockResolvedValue({ decision: 'newTarget', relay: newTargetRelay })
    asMockedFunction(got.post).mockReturnValue({ json } as any)
    const service = new NetcodeV2Service()

    const r1 = await service.rehomeSession(42, 7)
    const r2 = await service.rehomeSession(42, 7)

    expect(got.post).toHaveBeenCalledTimes(1)
    expect(r1.decision).toBe('newTarget')
    expect(r2).toEqual(r1)
  })

  test('re-asks the coordinator for a transient stay (never cached)', async () => {
    configureNetcodeV2()
    const json = vi.fn().mockResolvedValue({ decision: 'stay' })
    asMockedFunction(got.post).mockReturnValue({ json } as any)
    const service = new NetcodeV2Service()

    await service.rehomeSession(42, 7)
    await service.rehomeSession(42, 7)

    expect(got.post).toHaveBeenCalledTimes(2)
  })

  test('re-asks the coordinator for a transient unavailable (never cached)', async () => {
    configureNetcodeV2()
    const json = vi.fn().mockResolvedValue({ decision: 'unavailable' })
    asMockedFunction(got.post).mockReturnValue({ json } as any)
    const service = new NetcodeV2Service()

    await service.rehomeSession(42, 7)
    await service.rehomeSession(42, 7)

    expect(got.post).toHaveBeenCalledTimes(2)
  })

  test('a different dead relay on the same session is its own coordinator call', async () => {
    configureNetcodeV2()
    const json = vi.fn().mockResolvedValue({ decision: 'newTarget', relay: newTargetRelay })
    asMockedFunction(got.post).mockReturnValue({ json } as any)
    const service = new NetcodeV2Service()

    await service.rehomeSession(42, 7)
    await service.rehomeSession(42, 8)

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

    await expect(service.rehomeSession(42, 7)).rejects.toThrow('coordinator session rehome failed')
    const r2 = await service.rehomeSession(42, 7)

    expect(got.post).toHaveBeenCalledTimes(2)
    expect(r2.decision).toBe('newTarget')
  })
})
