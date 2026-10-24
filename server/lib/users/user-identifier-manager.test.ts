import { beforeEach, expect, test, vi } from 'vitest'
import { asMockedFunction } from '../../../common/testing/mocks'
import { makeSbUserId } from '../../../common/users/sb-user-id'
import { DbClient } from '../db'
import { BanEnacter } from './ban-enacter'
import { RestrictionService } from './restriction-service'
import { UserIdentifierManager } from './user-identifier-manager'
import { upsertUserIdentifiers } from './user-identifiers'

vi.mock('./user-identifiers', () => ({ upsertUserIdentifiers: vi.fn() }))

const userId = makeSbUserId(42)
const ids: [number, string][] = [[1, 'ab'.repeat(32)]]
const converted: [number, Buffer][] = [[1, Buffer.from(ids[0][1], 'hex')]]
const client = {} as DbClient
const restrictions = { handleNewIdentifiers: vi.fn() }
const manager = new UserIdentifierManager(
  {} as BanEnacter,
  {} as any,
  restrictions as unknown as RestrictionService,
)

beforeEach(() => {
  vi.resetAllMocks()
  asMockedFunction(upsertUserIdentifiers).mockResolvedValue({ newIdentifiers: converted })
})

test('transactional persistence leaves restriction propagation to the post-commit caller', async () => {
  const afterCommit = await manager.upsertInTransaction(userId, ids, client)
  expect(upsertUserIdentifiers).toHaveBeenCalledWith(userId, converted, client)
  expect(restrictions.handleNewIdentifiers).not.toHaveBeenCalled()
  await afterCommit()
  expect(restrictions.handleNewIdentifiers).toHaveBeenCalledWith(userId, converted)
})

test('failed identifier persistence rejects without restriction side effects', async () => {
  const error = new Error('write failed')
  asMockedFunction(upsertUserIdentifiers).mockRejectedValue(error)
  await expect(manager.upsertInTransaction(userId, ids, client)).rejects.toBe(error)
  expect(restrictions.handleNewIdentifiers).not.toHaveBeenCalled()
})

test('post-commit restriction failures remain observable to the caller', async () => {
  const error = new Error('restriction failed')
  restrictions.handleNewIdentifiers.mockRejectedValue(error)
  const afterCommit = await manager.upsertInTransaction(userId, ids, client)
  await expect(afterCommit()).rejects.toBe(error)
})

test('unchanged identifiers need no restriction propagation', async () => {
  asMockedFunction(upsertUserIdentifiers).mockResolvedValue({ newIdentifiers: [] })
  await (
    await manager.upsertInTransaction(userId, ids, client)
  )()
  expect(restrictions.handleNewIdentifiers).not.toHaveBeenCalled()
})

test('ordinary upserts still await propagation', async () => {
  await manager.upsert(userId, ids)
  expect(restrictions.handleNewIdentifiers).toHaveBeenCalledWith(userId, converted)
})

test('completed signup retries reconcile restrictions even when every ID already exists', async () => {
  restrictions.handleNewIdentifiers.mockRejectedValueOnce(new Error('temporary failure'))
  const afterCommit = await manager.upsertInTransaction(userId, ids, client)
  await expect(afterCommit()).rejects.toThrow('temporary failure')

  asMockedFunction(upsertUserIdentifiers).mockResolvedValue({ newIdentifiers: [] })
  await manager.upsertAndReconcileRestrictions(userId, ids)
  expect(restrictions.handleNewIdentifiers).toHaveBeenCalledTimes(2)
  expect(restrictions.handleNewIdentifiers).toHaveBeenLastCalledWith(userId, converted)
})
