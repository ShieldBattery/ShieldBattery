import { beforeEach, expect, Mock, test, vi } from 'vitest'
import createDeferred from '../../../common/async/deferred'
import { asMockedFunction } from '../../../common/testing/mocks'
import { makeSbUserId } from '../../../common/users/sb-user-id'
import { DbClient } from '../db'
import transact from '../db/transaction'
import { getPermissions } from '../models/permissions'
import { createUser } from './user-model'

const client = vi.hoisted(() => ({ query: vi.fn() }))
vi.mock('../db', () => ({ default: async (value: unknown) => ({ client: value, done: vi.fn() }) }))
vi.mock('../db/transaction', () => ({ default: vi.fn() }))
vi.mock('../models/permissions', () => ({
  createPermissions: async () => ({}),
  getPermissions: vi.fn(),
}))
vi.mock('./user-stats-model', () => ({ createUserStats: async () => {} }))
vi.mock('../files', () => ({ getUrl: vi.fn() }))

const userId = makeSbUserId(42)
type CreationOptions = Parameters<typeof createUser>[0]
type CreationRequest = NonNullable<CreationOptions['request']>
let request: {
  lock: Mock<CreationRequest['lock']>
  complete: Mock<CreationRequest['complete']>
}
let completeCreationFn: Mock<CreationOptions['completeCreationFn']>

function create() {
  return createUser({
    name: 'example',
    email: 'example@example.org',
    hashedPassword: 'hashed',
    ipAddress: '127.0.0.1',
    request,
    completeCreationFn,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  asMockedFunction(transact).mockImplementation(async next => next(client as unknown as DbClient))
  asMockedFunction(getPermissions).mockResolvedValue({} as any)
  client.query.mockResolvedValue({ rows: [{ id: userId, name: 'example', created: new Date() }] })
  request = { lock: vi.fn(), complete: vi.fn() }
  completeCreationFn = vi.fn()
})

test('request validation runs before any account writes', async () => {
  request.lock.mockRejectedValue(new Error('expired'))
  await expect(create()).rejects.toThrow('expired')
  expect(client.query).not.toHaveBeenCalled()
  expect(completeCreationFn).not.toHaveBeenCalled()
  expect(request.complete).not.toHaveBeenCalled()
})

test('a consumed request returns the same account without repeating creation side effects', async () => {
  request.lock.mockResolvedValue(userId)
  const result = await create()
  expect(result).toMatchObject({ user: { id: userId }, reused: true })
  expect(getPermissions).toHaveBeenCalledWith(userId, client)
  expect(completeCreationFn).not.toHaveBeenCalled()
  expect(request.complete).not.toHaveBeenCalled()
})

test('consumption shares the account transaction and does not finish before commit', async () => {
  const ready = createDeferred<void>()
  const commit = createDeferred<void>()
  asMockedFunction(transact).mockImplementation(async next => {
    const result = await next(client as unknown as DbClient)
    ready.resolve()
    await commit
    return result
  })
  let finished = false
  const pending = create().then(result => {
    finished = true
    return result
  })
  await ready
  expect(request.lock).toHaveBeenCalledWith(client)
  expect(request.complete).toHaveBeenCalledWith(client, userId)
  expect(finished).toBe(false)
  commit.resolve()
  expect(await pending).toMatchObject({ user: { id: userId } })
})

test('failed initial setup cannot consume the challenge', async () => {
  completeCreationFn.mockRejectedValue(new Error('setup failed'))
  await expect(create()).rejects.toThrow('setup failed')
  expect(request.complete).not.toHaveBeenCalled()
})

test('identifier persistence failure reaches the transaction boundary and rejects commit observers', async () => {
  const error = new Error('identifier write failed')
  const rolledBack = vi.fn()
  asMockedFunction(transact).mockImplementation(async next => {
    try {
      return await next(client as unknown as DbClient)
    } catch (err) {
      rolledBack(err)
      throw err
    }
  })
  let completed: Promise<void> | undefined
  completeCreationFn.mockImplementation(async (_userId, _client, transactionCompleted) => {
    completed = transactionCompleted
    throw error
  })
  await expect(create()).rejects.toBe(error)
  expect(rolledBack).toHaveBeenCalledWith(error)
  await expect(completed).rejects.toBe(error)
  expect(request.complete).not.toHaveBeenCalled()
})
