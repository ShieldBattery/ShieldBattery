import { generateKeyPairSync, sign } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { asMockedFunction } from '../../../common/testing/mocks'
import { ClientProof, SignupFields } from '../../../common/users/client-proof'
import { makeSbUserId } from '../../../common/users/sb-user-id'
import { UserErrorCode } from '../../../common/users/user-network'
import { DbClient } from '../db'
import { SessionReleaseCatalog } from '../netcode-v2/session-release-catalog'
import { Clock } from '../time/clock'
import { SignupProofService } from './signup-proof-service'
import {
  completeSignupRequest,
  findSignupRequest,
  insertSignupRequest,
  SignupRequest,
} from './signup-request-models'

const identifierPolicy = vi.hoisted(() => ({ minimum: 1 }))
const environment = vi.hoisted(() => ({ isDev: true }))
vi.mock('../env/is-dev', () => ({
  get default() {
    return environment.isDev
  },
}))
vi.mock('./client-ids', () => ({
  get MIN_IDENTIFIER_MATCHES() {
    return identifierPolicy.minimum
  },
}))

vi.mock('./signup-request-models', () => ({
  completeSignupRequest: vi.fn(),
  findSignupRequest: vi.fn(),
  insertSignupRequest: vi.fn(),
}))

const key = generateKeyPairSync('ed25519')
const publicKey = key.publicKey
  .export({ format: 'der', type: 'spki' })
  .subarray(-32)
  .toString('hex')
const fields: SignupFields = {
  username: 'test-user',
  password: 'secret-password',
  email: 'test@example.org',
  locale: 'en',
  signupCode: 'example',
}
let now: number
let request: SignupRequest
let enabled: boolean
let service: SignupProofService

function signed(
  body: Buffer = Buffer.concat([Buffer.from([1, 1, 1, 1]), Buffer.alloc(32, 7)]),
): ClientProof {
  const keyId = Buffer.alloc(4)
  keyId.writeUInt32LE(17)
  const bytes = Buffer.concat([
    Buffer.from('sb-client-request-v1\0'),
    keyId,
    request.nonce,
    request.requestHash,
    body,
  ])
  return {
    keyId: 17,
    body: body.toString('base64'),
    signature: sign(null, bytes, key.privateKey).toString('base64'),
  }
}

beforeEach(async () => {
  vi.clearAllMocks()
  identifierPolicy.minimum = 1
  environment.isDev = true
  vi.stubEnv('SB_JWT_SECRET', 'signup-test-secret')
  vi.stubEnv('SB_RP2_RELEASE_ENVIRONMENT', 'development')
  vi.stubEnv('SB_ALLOW_UNSIGNED_SIGNUP', undefined)
  now = 10_000
  enabled = true
  service = new SignupProofService(
    {
      getClientKeys: () => (enabled ? [{ keyId: 17, publicKey }] : []),
    } as unknown as SessionReleaseCatalog,
    { now: () => now } as Clock,
  )
  asMockedFunction(insertSignupRequest).mockImplementation(async value => {
    request = value
  })
  asMockedFunction(findSignupRequest).mockImplementation(async id =>
    id === request.id ? request : undefined,
  )
  await service.challenge(fields)
})

afterEach(() => vi.unstubAllEnvs())

test('uses only the signed identifiers and locks consumption in the caller transaction', async () => {
  const result = await service.verify(fields, request.id, signed())
  expect(result?.clientIds).toEqual([[1, '07'.repeat(32)]])
  const client = {} as DbClient
  expect(await result!.lock(client)).toBeUndefined()
  expect(findSignupRequest).toHaveBeenLastCalledWith(request.id, client)
  await result!.complete(client, makeSbUserId(42))
  expect(completeSignupRequest).toHaveBeenCalledWith(client, request.id, 42)
})

test('requires proof whenever client keys are configured', async () => {
  await expect(service.verify(fields)).rejects.toThrow('Invalid client request')
  await expect(service.verify(fields, request.id)).rejects.toThrow()
})

test('unconfigured local builds neither create a challenge nor require a proof', async () => {
  vi.clearAllMocks()
  enabled = false
  expect(await service.challenge(fields)).toEqual({ required: false })
  expect(await service.verify(fields)).toBeUndefined()
  expect(insertSignupRequest).not.toHaveBeenCalled()
})

test('production without client keys refuses challenges and unsigned account creation', async () => {
  vi.stubEnv('SB_RP2_RELEASE_ENVIRONMENT', 'production')
  enabled = false
  vi.clearAllMocks()
  await expect(service.challenge(fields)).rejects.toMatchObject({ status: 503 })
  await expect(service.verify(fields)).rejects.toMatchObject({ status: 503 })
  expect(insertSignupRequest).not.toHaveBeenCalled()
  expect(findSignupRequest).not.toHaveBeenCalled()
})

test('production still accepts an approved signed request', async () => {
  vi.stubEnv('SB_RP2_RELEASE_ENVIRONMENT', 'production')
  expect(await service.challenge(fields)).toMatchObject({ required: true })
  expect(await service.verify(fields, request.id, signed())).toMatchObject({
    clientIds: [[1, '07'.repeat(32)]],
  })
})

test('a deployed server without catalog configuration refuses unsigned signup', async () => {
  environment.isDev = false
  vi.stubEnv('SB_RP2_RELEASE_ENVIRONMENT', undefined)
  enabled = false
  vi.clearAllMocks()
  await expect(service.challenge(fields)).rejects.toMatchObject({ status: 503 })
  await expect(service.verify(fields)).rejects.toMatchObject({ status: 503 })
  expect(insertSignupRequest).not.toHaveBeenCalled()
  expect(findSignupRequest).not.toHaveBeenCalled()
})

test('public deployments can explicitly allow signup without client keys', async () => {
  environment.isDev = false
  vi.stubEnv('SB_RP2_RELEASE_ENVIRONMENT', undefined)
  vi.stubEnv('SB_ALLOW_UNSIGNED_SIGNUP', 'true')
  enabled = false
  vi.clearAllMocks()
  expect(await service.challenge(fields)).toEqual({ required: false })
  expect(await service.verify(fields)).toBeUndefined()
  expect(insertSignupRequest).not.toHaveBeenCalled()
  expect(findSignupRequest).not.toHaveBeenCalled()
})

test.each(['', 'false', '1', 'TRUE'])(
  'unsigned signup requires an exact opt-out: %j',
  async value => {
    environment.isDev = false
    vi.stubEnv('SB_ALLOW_UNSIGNED_SIGNUP', value)
    enabled = false
    await expect(service.challenge(fields)).rejects.toMatchObject({ status: 503 })
    await expect(service.verify(fields)).rejects.toMatchObject({ status: 503 })
  },
)

test('the unsigned opt-out does not bypass configured client keys', async () => {
  environment.isDev = false
  vi.stubEnv('SB_ALLOW_UNSIGNED_SIGNUP', 'true')
  expect(await service.challenge(fields)).toMatchObject({ required: true })
  await expect(service.verify(fields)).rejects.toThrow('Invalid client request')
})

test.each<keyof SignupFields>(['username', 'password', 'email', 'locale', 'signupCode'])(
  'binds the proof to %s',
  async field => {
    await expect(
      service.verify({ ...fields, [field]: 'different' }, request.id, signed()),
    ).rejects.toThrow()
  },
)

test('cannot replay a signature for a different challenge', async () => {
  const proof = signed()
  const oldId = request.id
  await service.challenge(fields)
  expect(request.id).not.toBe(oldId)
  await expect(service.verify(fields, request.id, proof)).rejects.toThrow()
})

test('rejects unknown keys, invalid signatures, and unsigned changes to the body', async () => {
  const proof = signed()
  await expect(service.verify(fields, request.id, { ...proof, keyId: 99 })).rejects.toThrow()
  await expect(
    service.verify(fields, request.id, {
      ...proof,
      signature: Buffer.alloc(64).toString('base64'),
    }),
  ).rejects.toThrow()
  const body = Buffer.from(proof.body, 'base64')
  body[5] ^= 1
  await expect(
    service.verify(fields, request.id, { ...proof, body: body.toString('base64') }),
  ).rejects.toThrow()
})

test('requires bounded canonical encodings', async () => {
  const proof = signed()
  for (const body of [proof.body + '\n', 'A'.repeat(364), proof.body.replace(/=+$/, '') + '=']) {
    await expect(service.verify(fields, request.id, { ...proof, body })).rejects.toThrow()
  }
  await expect(
    service.verify(fields, request.id, { ...proof, signature: proof.signature.slice(0, -1) }),
  ).rejects.toThrow()
})

describe('signed body validation', () => {
  test.each([
    Buffer.from([1, 0, 0]),
    Buffer.concat([Buffer.from([2, 1, 1, 1]), Buffer.alloc(32)]),
    Buffer.concat([Buffer.from([1, 2, 1, 1]), Buffer.alloc(32)]),
    Buffer.concat([
      Buffer.from([1, 1, 2, 1]),
      Buffer.alloc(32),
      Buffer.from([1]),
      Buffer.alloc(32),
    ]),
    Buffer.concat([
      Buffer.from([1, 3, 2, 2]),
      Buffer.alloc(32),
      Buffer.from([1]),
      Buffer.alloc(32),
    ]),
    Buffer.concat([Buffer.from([1, 64, 1, 7]), Buffer.alloc(32)]),
    Buffer.concat([Buffer.from([1, 0, 1, 0]), Buffer.alloc(32)]),
    Buffer.concat([Buffer.from([1, 0, 1, 9]), Buffer.alloc(32)]),
    Buffer.concat([Buffer.from([1, 1, 1, 1]), Buffer.alloc(33)]),
  ])('rejects malformed signed bodies %#', async body => {
    await expect(service.verify(fields, request.id, signed(body))).rejects.toThrow()
  })
})

test('does not retain the password or other account fields in the challenge row', () => {
  expect(Object.keys(request).sort()).toEqual(['expiresAt', 'id', 'nonce', 'requestHash'])
  expect(request.requestHash).toHaveLength(32)
})

test('rechecks expiry after waiting for the creation lock', async () => {
  const result = await service.verify(fields, request.id, signed())
  now = request.expiresAt.getTime()
  await expect(result!.lock({} as DbClient)).rejects.toThrow()
  expect(completeSignupRequest).not.toHaveBeenCalled()
})

test('concurrent duplicate finds the account committed by the lock owner', async () => {
  const result = await service.verify(fields, request.id, signed())
  request.userId = makeSbUserId(42)
  expect(await result!.lock({} as DbClient)).toBe(42)
  const retry = await service.verify(fields, request.id, signed())
  expect(retry?.completedUserId).toBe(42)
  now = request.expiresAt.getTime()
  await expect(service.verify(fields, request.id, signed())).rejects.toThrow()
})

test('request bindings depend on the server secret', async () => {
  const proof = signed()
  vi.stubEnv('SB_JWT_SECRET', 'different-signup-test-secret')
  await expect(service.verify(fields, request.id, proof)).rejects.toThrow()
})

test.each([1, 2, 3])('production signup rejects only %i signed identifiers', async count => {
  identifierPolicy.minimum = 4
  const body = Buffer.concat([
    Buffer.from([1, (1 << count) - 1, count]),
    ...Array.from({ length: count }, (_, i) =>
      Buffer.concat([Buffer.from([i + 1]), Buffer.alloc(32, i + 1)]),
    ),
  ])
  await expect(service.verify(fields, request.id, signed(body))).rejects.toMatchObject({
    code: UserErrorCode.ClientSetupRequired,
  })
})

function identifierBody(format: 1 | 2, kinds: readonly number[]): Buffer {
  const mask = kinds.reduce((value, kind) => value | (1 << (kind - 1)), 0)
  const header =
    format === 1
      ? Buffer.from([1, mask, kinds.length])
      : Buffer.from([2, mask & 0xff, mask >> 8, kinds.length])
  return Buffer.concat([
    header,
    ...kinds.map(kind => Buffer.concat([Buffer.from([kind]), Buffer.alloc(32, kind)])),
  ])
}

test.each([
  ['legacy four identifiers', 1, [1, 2, 5, 6]],
  ['legacy full identifiers', 1, [1, 2, 3, 4, 5, 6]],
  ['Wine identifiers and install identity', 2, [1, 2, 3, 9]],
  ['extended Wine identifiers', 2, [1, 2, 3, 6, 8, 9]],
  ['all supported identifiers', 2, [1, 2, 3, 4, 5, 6, 8, 9]],
] as const)('production signup accepts %s', async (_name, format, kinds) => {
  identifierPolicy.minimum = 4
  const result = await service.verify(fields, request.id, signed(identifierBody(format, kinds)))
  expect(result?.clientIds).toEqual(
    kinds.map(kind => [kind, kind.toString(16).padStart(2, '0').repeat(32)]),
  )
})

test.each([1, 2] as const)(
  'format %i rejects reserved and unknown identifier kinds',
  async format => {
    for (const kind of format === 1 ? [0, 7, 8, 9] : [0, 7, 10]) {
      await expect(
        service.verify(fields, request.id, signed(identifierBody(format, [kind]))),
      ).rejects.toThrow()
    }
  },
)

test('version 2 requires exact low and high masks, count, and sorted unique records', async () => {
  const body = identifierBody(2, [1, 8, 9])
  expect((await service.verify(fields, request.id, signed(body)))?.clientIds).toHaveLength(3)
  for (const [offset, value] of [
    [1, 1],
    [1, 193],
    [2, 0],
    [2, 3],
    [2, 128],
    [3, 9],
    [4, 8],
    [37, 1],
    [70, 8],
  ]) {
    const malformed = Buffer.from(body)
    malformed[offset] = value
    await expect(service.verify(fields, request.id, signed(malformed))).rejects.toThrow()
  }
  for (let end = 0; end < body.length; end += 1) {
    await expect(
      service.verify(fields, request.id, signed(body.subarray(0, end))),
    ).rejects.toThrow()
  }
  await expect(
    service.verify(fields, request.id, signed(Buffer.concat([body, Buffer.from([0])]))),
  ).rejects.toThrow()
  identifierPolicy.minimum = 4
  await expect(service.verify(fields, request.id, signed(body))).rejects.toThrow()
})

test('only canonical valid signed evidence can request client setup', async () => {
  identifierPolicy.minimum = 4
  const body = identifierBody(2, [1, 2, 9])
  await expect(service.verify(fields, request.id, signed(body))).rejects.toMatchObject({
    code: UserErrorCode.ClientSetupRequired,
  })
  const proof = signed(body)
  await expect(
    service.verify(fields, request.id, {
      ...proof,
      signature: Buffer.alloc(64).toString('base64'),
    }),
  ).rejects.toMatchObject({ status: 400, message: 'Invalid client request' })
  body[2] = 0
  await expect(service.verify(fields, request.id, signed(body))).rejects.toMatchObject({
    status: 400,
    message: 'Invalid client request',
  })
})
