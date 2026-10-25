import got from 'got'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import createDeferred from '../../../common/async/deferred'
import { asMockedFunction } from '../../../common/testing/mocks'
import { makeSbUserId } from '../../../common/users/sb-user-id'
import { UserErrorCode } from '../../../common/users/user-network'
import { DbClient } from '../db'
import { SessionReleaseCatalog } from '../netcode-v2/session-release-catalog'
import { Clock } from '../time/clock'
import { isUserBanned } from './ban-models'
import { SignupProofService, VerifiedSignupRequest } from './signup-proof-service'
import { UserApi } from './user-api'
import { UserIdentifierManager } from './user-identifier-manager'
import { createUser } from './user-model'

vi.mock('../mail/mailer', () => ({ sendMailTemplate: vi.fn() }))
vi.mock('./password-reset-cleanup', () => ({ PasswordResetCleanupJob: class {} }))
vi.mock('./signup-code-cleanup', () => ({ SignupCodeCleanupJob: class {} }))
vi.mock('./user-identifier-cleanup', () => ({ UserIdentifierCleanupJob: class {} }))
vi.mock('./user-ips-cleanup', () => ({ UserIpsCleanupJob: class {} }))
vi.mock('./user-model', () => ({ createUser: vi.fn() }))
vi.mock('./ban-models', () => ({ isUserBanned: vi.fn() }))
vi.mock('./email-verification-models', () => ({ addEmailVerificationCode: vi.fn() }))
vi.mock('./random-code', () => ({ genRandomCode: async () => 'verification-code' }))
vi.mock('../session/jwt-session-middleware', () => ({ getJwt: async () => 'token' }))
vi.mock('got', () => ({ default: { post: vi.fn() } }))
vi.mock('bcrypt', () => ({ default: { hash: async () => 'hashed-password' } }))
vi.mock('../env/is-dev', () => ({ default: false }))

const signedIds: [number, string][] = [[1, 'ab'.repeat(32)]]
const unsignedIds: [number, string][] = [[1, 'cd'.repeat(32)]]
const userId = makeSbUserId(42)
const user = { id: userId, loginName: 'example', name: 'example' }
let request: VerifiedSignupRequest
let service: SignupProofService
let api: UserApi
let ctx: any
let manager: {
  upsert: ReturnType<typeof vi.fn>
  upsertAndReconcileRestrictions: ReturnType<
    typeof vi.fn<UserIdentifierManager['upsertAndReconcileRestrictions']>
  >
  upsertInTransaction: ReturnType<typeof vi.fn>
  isSignupAllowed: ReturnType<typeof vi.fn>
  findUsersWithIdentifiers: ReturnType<typeof vi.fn>
  banUserIfNeeded: ReturnType<typeof vi.fn>
}

function createApi(proofService: SignupProofService): UserApi {
  return new UserApi(
    {} as any,
    manager as any,
    {} as any,
    {} as any,
    { now: () => 1 } as any,
    {} as any,
    {} as any,
    { joinInitialChannel: vi.fn() } as any,
    {} as any,
    {} as any,
    {} as any,
    proofService,
  )
}

afterEach(() => vi.unstubAllEnvs())

beforeEach(() => {
  vi.clearAllMocks()
  request = { clientIds: signedIds, lock: vi.fn(), complete: vi.fn() }
  service = { verify: vi.fn().mockResolvedValue(request) } as unknown as SignupProofService
  manager = {
    upsert: vi.fn(),
    upsertAndReconcileRestrictions:
      vi.fn<UserIdentifierManager['upsertAndReconcileRestrictions']>(),
    upsertInTransaction: vi.fn(),
    isSignupAllowed: vi.fn().mockResolvedValue(true),
    findUsersWithIdentifiers: vi.fn().mockResolvedValue([]),
    banUserIfNeeded: vi.fn().mockResolvedValue(false),
  }
  api = createApi(service)
  ctx = {
    get: () => 'shieldbattery://app',
    request: {
      body: {
        username: 'example',
        password: 'secret-password',
        email: 'example@example.org',
        attemptId: '00dbbc85-dd60-4bef-b275-be3cb76ae6d5',
        proof: { keyId: 17, body: 'body', signature: 'signature' },
        clientIds: unsignedIds,
      },
    },
    ip: '127.0.0.1',
    log: { error: vi.fn() },
    beginSession: vi.fn(async () => {
      ctx.session = { user, permissions: {} }
    }),
  }
  asMockedFunction(createUser).mockResolvedValue({ user, permissions: {}, reused: true } as any)
  asMockedFunction(isUserBanned).mockResolvedValue(false)
  asMockedFunction(got.post).mockReturnValue({ json: async () => ({ allowed: true }) } as any)
})

function prepareUnsignedBootstrap(allowed: boolean) {
  vi.stubEnv('SB_ALLOW_UNSIGNED_SIGNUP', allowed ? 'true' : undefined)
  const proofService = new SignupProofService(
    { getClientKeys: () => [] } as unknown as SessionReleaseCatalog,
    { now: () => 1 } as Clock,
  )
  api = createApi(proofService)
  delete ctx.request.body.attemptId
  delete ctx.request.body.proof
  ctx.request.body.clientIds = [[0, 'adminBrowser']]
}

test('explicit opt-out permits unsigned integration bootstrap signup', async () => {
  prepareUnsignedBootstrap(true)
  await api.createUser(ctx)
  expect(createUser).toHaveBeenCalledWith(expect.objectContaining({ request: undefined }))
  expect(manager.isSignupAllowed).toHaveBeenCalledWith([[0, 'adminBrowser']])
  expect(ctx.beginSession).toHaveBeenCalledWith(userId, false, 'app')
})

test('deployed bootstrap signup remains closed without explicit opt-out', async () => {
  prepareUnsignedBootstrap(false)
  await expect(api.createUser(ctx)).rejects.toMatchObject({ status: 503 })
  expect(createUser).not.toHaveBeenCalled()
  expect(ctx.beginSession).not.toHaveBeenCalled()
})

test('machine checks and persistence use signed identifiers, ignoring supplied identifiers', async () => {
  await api.createUser(ctx)
  expect(manager.isSignupAllowed).toHaveBeenCalledWith(signedIds)
  expect(manager.findUsersWithIdentifiers).toHaveBeenCalledWith(signedIds)
  expect(manager.upsertAndReconcileRestrictions).toHaveBeenCalledWith(userId, signedIds)
  expect(createUser).toHaveBeenCalledWith(expect.objectContaining({ request }))
})

test('accepts a full native identifier envelope through request validation', async () => {
  ctx.request.body.proof.body = Buffer.alloc(268).toString('base64')
  await api.createUser(ctx)
  expect(service.verify).toHaveBeenCalledWith(
    expect.anything(),
    ctx.request.body.attemptId,
    ctx.request.body.proof,
  )
  expect(manager.upsertAndReconcileRestrictions).toHaveBeenCalledWith(userId, signedIds)
})

test('a rejected proof never reaches account creation or preflight checks', async () => {
  asMockedFunction(service.verify).mockRejectedValue(new Error('Invalid client request'))
  await expect(api.createUser(ctx)).rejects.toThrow('Invalid client request')
  expect(createUser).not.toHaveBeenCalled()
  expect(got.post).not.toHaveBeenCalled()
  expect(manager.isSignupAllowed).not.toHaveBeenCalled()
})

test('completed retries bypass create-only checks but cannot log into a banned account', async () => {
  request.completedUserId = userId
  asMockedFunction(isUserBanned).mockResolvedValue(true)
  await expect(api.createUser(ctx)).rejects.toMatchObject({ code: UserErrorCode.AccountBanned })
  expect(got.post).not.toHaveBeenCalled()
  expect(manager.findUsersWithIdentifiers).not.toHaveBeenCalled()
  expect(ctx.beginSession).not.toHaveBeenCalled()
})

test('a concurrent completed request can recover after username preflight rejects its new account', async () => {
  asMockedFunction(got.post).mockReturnValue({ json: async () => ({ allowed: false }) } as any)
  asMockedFunction(service.verify)
    .mockResolvedValueOnce(request)
    .mockResolvedValueOnce({ ...request, completedUserId: userId })
  await api.createUser(ctx)
  expect(createUser).toHaveBeenCalledWith(expect.objectContaining({ request }))
  expect(ctx.beginSession).toHaveBeenCalledWith(userId, false, 'app')
})

test.each(['expired', 'database unavailable'])(
  'preserves the preflight error when rechecking the challenge fails: %s',
  async message => {
    asMockedFunction(got.post).mockReturnValue({ json: async () => ({ allowed: false }) } as any)
    asMockedFunction(service.verify)
      .mockResolvedValueOnce(request)
      .mockRejectedValueOnce(new Error(message))
    await expect(api.createUser(ctx)).rejects.toMatchObject({
      code: UserErrorCode.UsernameTakenOrRestricted,
    })
    expect(createUser).not.toHaveBeenCalled()
    expect(ctx.beginSession).not.toHaveBeenCalled()
  },
)

test('new account identifiers share creation and restriction propagation waits for commit', async () => {
  const client = {} as DbClient
  const ready = createDeferred<void>()
  const committed = createDeferred<void>()
  const propagate = vi.fn()
  manager.upsertInTransaction.mockResolvedValue(propagate)
  asMockedFunction(createUser).mockImplementation(async options => {
    await options.completeCreationFn(userId, client, committed)
    ready.resolve()
    await committed
    return { user, permissions: {} } as any
  })
  const pending = api.createUser(ctx)
  await ready
  expect(manager.upsertInTransaction).toHaveBeenCalledWith(userId, signedIds, client)
  expect(propagate).not.toHaveBeenCalled()
  expect(ctx.beginSession).not.toHaveBeenCalled()
  committed.resolve()
  await pending
  expect(propagate).toHaveBeenCalledOnce()
  expect(manager.upsert).not.toHaveBeenCalled()
  expect(ctx.beginSession).toHaveBeenCalledWith(userId, false, 'app')
})

test('identifier write failure rejects the account transaction callback before any session', async () => {
  const error = new Error('identifier write failed')
  manager.upsertInTransaction.mockRejectedValue(error)
  asMockedFunction(createUser).mockImplementation(async options => {
    await options.completeCreationFn(userId, {} as DbClient, Promise.resolve())
    throw new Error('Creation must not complete after a failed identifier write')
  })
  await expect(api.createUser(ctx)).rejects.toBe(error)
  expect(manager.upsert).not.toHaveBeenCalled()
  expect(ctx.beginSession).not.toHaveBeenCalled()
})

test('account commit failure never propagates uncommitted identifier restrictions', async () => {
  const error = new Error('commit failed')
  const propagate = vi.fn()
  manager.upsertInTransaction.mockResolvedValue(propagate)
  asMockedFunction(createUser).mockImplementation(async options => {
    await options.completeCreationFn(userId, {} as DbClient, Promise.resolve())
    throw error
  })
  await expect(api.createUser(ctx)).rejects.toBe(error)
  expect(propagate).not.toHaveBeenCalled()
  expect(ctx.beginSession).not.toHaveBeenCalled()
})

test('a completed retry repairs post-commit restriction failure before opening a session', async () => {
  const error = new Error('restriction propagation failed')
  const propagate = vi.fn().mockRejectedValueOnce(error)
  manager.upsertInTransaction.mockResolvedValue(propagate)
  asMockedFunction(createUser).mockImplementationOnce(async options => {
    await options.completeCreationFn(userId, {} as DbClient, Promise.resolve())
    request.completedUserId = userId
    return { user, permissions: {} } as any
  })
  await expect(api.createUser(ctx)).rejects.toBe(error)
  expect(ctx.beginSession).not.toHaveBeenCalled()

  const reconciled = createDeferred<void>()
  const started = createDeferred<void>()
  manager.upsertAndReconcileRestrictions.mockImplementationOnce(async () => {
    started.resolve()
    await reconciled
  })
  const retry = api.createUser(ctx)
  await started
  expect(manager.upsertAndReconcileRestrictions).toHaveBeenCalledWith(userId, signedIds)
  expect(ctx.beginSession).not.toHaveBeenCalled()
  reconciled.resolve()
  await retry
  expect(ctx.beginSession).toHaveBeenCalledOnce()
})
