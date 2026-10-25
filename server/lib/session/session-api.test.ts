import { beforeEach, expect, test, vi } from 'vitest'
import { asMockedFunction } from '../../../common/testing/mocks'
import { makeSbUserId } from '../../../common/users/sb-user-id'
import { UserErrorCode } from '../../../common/users/user-network'
import { clientAttestationFailed } from '../users/client-attestation'
import { authorizeDevelopmentClients } from '../users/development-clients'
import { LoginAttestationService } from '../users/login-attestation-service'
import { attemptLogin } from '../users/user-model'
import { SocketAdmission } from '../websockets/socket-admission'
import { SessionApi } from './session-api'

vi.mock('../users/user-model', () => ({
  attemptLogin: vi.fn(),
  findSelfById: vi.fn(),
  maybeMigrateSignupIp: vi.fn(),
}))
vi.mock('../users/ban-models', () => ({
  isUserBanned: vi.fn(async () => false),
  retrieveBanHistory: vi.fn(),
}))
vi.mock('../users/development-clients', () => ({ authorizeDevelopmentClients: vi.fn() }))
vi.mock('./jwt-session-middleware', () => ({
  getJwt: async () => 'token',
  SessionError: class extends Error {},
}))

const signedIds: [number, string][] = [[1, 'ab'.repeat(32)]]
const legacyIds: [number, string][] = [[1, 'cd'.repeat(32)]]
const proof = { keyId: 17, body: 'body', signature: 'signature' }
const attemptId = '00dbbc85-dd60-4bef-b275-be3cb76ae6d5'
const userId = makeSbUserId(42)
const user = { id: userId, name: 'example', locale: 'en' }
const verificationFailure = expect.objectContaining({
  status: 403,
  payload: expect.objectContaining({ code: UserErrorCode.ClientVerificationFailed }),
})

const loginAttestation = { verify: vi.fn() }
const manager = { upsert: vi.fn(), banUserIfNeeded: vi.fn() }
// Only constructed once, since it registers metrics
const api = new SessionApi(
  manager as any,
  {} as any,
  loginAttestation as unknown as LoginAttestationService,
  {} as SocketAdmission,
  { now: () => 1 } as any,
)
let ctx: any

function createCtx(origin: string, body: Record<string, unknown>) {
  const result: any = {
    get: (header: string) => (header === 'Origin' ? origin : ''),
    request: { body: { username: 'example', password: 'secret-password', ...body } },
    query: {},
    params: {},
    ip: '127.0.0.1',
    log: { error: vi.fn() },
    beginSession: vi.fn(async () => {
      result.session = { user, permissions: {} }
    }),
  }
  return result
}

beforeEach(() => {
  vi.clearAllMocks()
  loginAttestation.verify.mockReset().mockResolvedValue(signedIds)
  manager.banUserIfNeeded.mockResolvedValue(false)
  asMockedFunction(attemptLogin).mockResolvedValue(user as any)
  asMockedFunction(authorizeDevelopmentClients).mockResolvedValue()
})

test('app logins check their proof and record only its signed identifiers', async () => {
  ctx = createCtx('shieldbattery://app', { attemptId, proof, clientIds: legacyIds })
  await api.startNewSession(ctx)
  expect(loginAttestation.verify).toHaveBeenCalledWith(
    { username: 'example', password: 'secret-password' },
    attemptId,
    proof,
  )
  expect(manager.upsert).toHaveBeenCalledWith(userId, signedIds)
  expect(ctx.beginSession).toHaveBeenCalledWith(userId, false, 'app')
})

test('app logins without a verified proof fall back to their legacy identifiers', async () => {
  loginAttestation.verify.mockResolvedValue(undefined)
  ctx = createCtx('shieldbattery://app', { clientIds: legacyIds })
  await api.startNewSession(ctx)
  expect(manager.upsert).toHaveBeenCalledWith(userId, legacyIds)
  expect(ctx.beginSession).toHaveBeenCalledWith(userId, false, 'app')
})

test("refused app logins don't check the password", async () => {
  loginAttestation.verify.mockImplementation(async () => clientAttestationFailed('invalid'))
  ctx = createCtx('shieldbattery://app', { clientIds: legacyIds })
  await expect(api.startNewSession(ctx)).rejects.toThrow(verificationFailure)
  expect(attemptLogin).not.toHaveBeenCalled()
  expect(ctx.beginSession).not.toHaveBeenCalled()
})

test('app logins always include legacy identifiers, even with a proof', async () => {
  ctx = createCtx('shieldbattery://app', { attemptId, proof })
  await expect(api.startNewSession(ctx)).rejects.toMatchObject({ status: 400 })
  expect(loginAttestation.verify).not.toHaveBeenCalled()
})

test('a verified proof can stand in for missing legacy identifiers', async () => {
  ctx = createCtx('shieldbattery://app', { attemptId, proof, clientIds: [] })
  await api.startNewSession(ctx)
  expect(manager.upsert).toHaveBeenCalledWith(userId, signedIds)
})

test('without a verified proof, app logins need legacy identifiers', async () => {
  loginAttestation.verify.mockResolvedValue(undefined)
  ctx = createCtx('shieldbattery://app', { attemptId, proof, clientIds: [] })
  await expect(api.startNewSession(ctx)).rejects.toMatchObject({ status: 400 })
  expect(attemptLogin).not.toHaveBeenCalled()
})

test('browser logins create web sessions without being asked for proofs', async () => {
  ctx = createCtx('https://shieldbattery.net', { clientIds: [] })
  await api.startNewSession(ctx)
  expect(loginAttestation.verify).not.toHaveBeenCalled()
  expect(ctx.beginSession).toHaveBeenCalledWith(userId, false, 'web')
})

test('development builds log in without proofs to accounts allowed to run them', async () => {
  ctx = createCtx('shieldbattery://app', { clientIds: legacyIds, developmentClient: true })
  await api.startNewSession(ctx)
  expect(loginAttestation.verify).not.toHaveBeenCalled()
  expect(authorizeDevelopmentClients).toHaveBeenCalledWith([userId])
  expect(ctx.beginSession).toHaveBeenCalledWith(userId, false, 'development')
})

test("development builds can't log in to other accounts", async () => {
  asMockedFunction(authorizeDevelopmentClients).mockRejectedValue(
    new Error('Development clients require permission'),
  )
  ctx = createCtx('shieldbattery://app', { clientIds: legacyIds, developmentClient: true })
  await expect(api.startNewSession(ctx)).rejects.toThrow(verificationFailure)
  expect(manager.upsert).not.toHaveBeenCalled()
  expect(ctx.beginSession).not.toHaveBeenCalled()
})

test('browsers cannot claim to be development builds', async () => {
  ctx = createCtx('https://shieldbattery.net', { clientIds: [], developmentClient: true })
  await expect(api.startNewSession(ctx)).rejects.toMatchObject({ status: 400 })
  expect(attemptLogin).not.toHaveBeenCalled()
})
