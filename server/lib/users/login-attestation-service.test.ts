import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { ClientChallenge, LoginChallengeRequest } from '../../../common/users/client-proof'
import { UserErrorCode } from '../../../common/users/user-network'
import { SessionReleaseCatalog, SessionReleaseKey } from '../netcode-v2/session-release-catalog'
import { Redis } from '../redis/redis'
import { ClientAttestation } from './client-attestation'
import { LoginAttestationService } from './login-attestation-service'
import { TestClientKey } from './testing/client-proofs'

const key = new TestClientKey()
const fields: LoginChallengeRequest = { username: 'example', password: 'secret-password' }
const verificationFailure = expect.objectContaining({
  status: 403,
  payload: expect.objectContaining({ code: UserErrorCode.ClientVerificationFailed }),
})

let keys: SessionReleaseKey[]
let stored: Map<string, string>
let redis: { setEx: ReturnType<typeof vi.fn>; getDel: ReturnType<typeof vi.fn> }
let service: LoginAttestationService

function signed(challenge: ClientChallenge) {
  return key.sign(challenge.nonce, challenge.requestHash)
}

beforeEach(() => {
  vi.stubEnv('SB_JWT_SECRET', 'login-attestation-test-secret')
  vi.stubEnv('SB_REQUIRE_CLIENT_ATTESTATION', undefined)
  keys = [key.releaseKey]
  stored = new Map()
  redis = {
    setEx: vi.fn(async (k: string, _ttl: number, value: string) => {
      stored.set(k, value)
    }),
    getDel: vi.fn(async (k: string) => {
      const value = stored.get(k) ?? null
      stored.delete(k)
      return value
    }),
  }
  service = new LoginAttestationService(
    new ClientAttestation({ getClientKeys: () => keys } as unknown as SessionReleaseCatalog),
    { client: redis } as unknown as Redis,
  )
})

afterEach(() => vi.unstubAllEnvs())

test('without client keys, logins are neither challenged nor checked', async () => {
  keys = []
  expect(await service.challenge(fields)).toEqual({})
  expect(await service.verify(fields, undefined, undefined)).toBeUndefined()
  expect(redis.setEx).not.toHaveBeenCalled()
})

describe('observing', () => {
  test('issues optional challenges that expire', async () => {
    const response = await service.challenge(fields)
    expect(response).toEqual({ challenge: expect.any(Object) })
    expect(redis.setEx).toHaveBeenCalledWith(expect.any(String), 300, expect.any(String))
  })

  test('returns the identifiers a valid proof signed', async () => {
    const { challenge } = await service.challenge(fields)
    expect(await service.verify(fields, challenge!.attemptId, signed(challenge!))).toEqual([
      [1, '07'.repeat(32)],
    ])
  })

  test('allows logins without a valid proof', async () => {
    const { challenge } = await service.challenge(fields)
    expect(await service.verify(fields, undefined, undefined)).toBeUndefined()
    expect(
      await service.verify(fields, challenge!.attemptId, new TestClientKey().sign('', '')),
    ).toBeUndefined()
  })
})

describe('requiring proofs', () => {
  beforeEach(() => {
    vi.stubEnv('SB_REQUIRE_CLIENT_ATTESTATION', 'true')
  })

  test('accepts a valid proof', async () => {
    const { challenge } = await service.challenge(fields)
    expect(await service.verify(fields, challenge!.attemptId, signed(challenge!))).toEqual([
      [1, '07'.repeat(32)],
    ])
  })

  test('refuses logins without a proof', async () => {
    const { challenge } = await service.challenge(fields)
    await expect(service.verify(fields, undefined, undefined)).rejects.toThrow(verificationFailure)
    await expect(service.verify(fields, challenge!.attemptId, undefined)).rejects.toThrow(
      verificationFailure,
    )
  })

  test('asks outdated builds to update', async () => {
    const { challenge } = await service.challenge(fields)
    const proof = new TestClientKey(99).sign(challenge!.nonce, challenge!.requestHash)
    await expect(service.verify(fields, challenge!.attemptId, proof)).rejects.toThrow(
      expect.objectContaining({
        status: 403,
        payload: expect.objectContaining({ code: UserErrorCode.ClientUpdateRequired }),
      }),
    )
  })

  test('refuses proofs with invalid signatures', async () => {
    const { challenge } = await service.challenge(fields)
    const proof = new TestClientKey().sign(challenge!.nonce, challenge!.requestHash)
    await expect(service.verify(fields, challenge!.attemptId, proof)).rejects.toThrow(
      verificationFailure,
    )
  })

  test.each<keyof LoginChallengeRequest>(['username', 'password'])(
    'binds the proof to the %s it was requested for',
    async field => {
      const { challenge } = await service.challenge(fields)
      await expect(
        service.verify(
          { ...fields, [field]: 'different' },
          challenge!.attemptId,
          signed(challenge!),
        ),
      ).rejects.toThrow(verificationFailure)
    },
  )

  test('each challenge can only be used once', async () => {
    const { challenge } = await service.challenge(fields)
    const proof = signed(challenge!)
    await service.verify(fields, challenge!.attemptId, proof)
    await expect(service.verify(fields, challenge!.attemptId, proof)).rejects.toThrow(
      verificationFailure,
    )
  })

  test("a proof can't be used with a different challenge", async () => {
    const { challenge: first } = await service.challenge(fields)
    const { challenge: second } = await service.challenge(fields)
    await expect(service.verify(fields, second!.attemptId, signed(first!))).rejects.toThrow(
      verificationFailure,
    )
  })

  test('without client keys, app logins are unavailable rather than silently allowed', async () => {
    keys = []
    await expect(service.challenge(fields)).rejects.toMatchObject({ status: 503 })
    await expect(service.verify(fields, undefined, undefined)).rejects.toMatchObject({
      status: 503,
    })
  })
})
