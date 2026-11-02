import Router from '@koa/router'
import got from 'got'
import Koa from 'koa'
import { Server } from 'node:http'
import { AddressInfo } from 'node:net'
import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest'
import { asMockedFunction } from '../../../common/testing/mocks'
import { makeSbUserId } from '../../../common/users/sb-user-id'
import { AdminGetLinkedAccountsResponse } from '../../../common/users/user-network'
import { applyApiRoutes } from '../http/http-api'
import { AdminUserApi } from './user-api'
import { findLinkedAccounts } from './user-identifiers'
import { findUserById, findUsersById } from './user-model'

vi.mock('../mail/mailer', () => ({ sendMailTemplate: vi.fn() }))
vi.mock('./user-identifiers', () => ({ findLinkedAccounts: vi.fn() }))
vi.mock('./user-model', () => ({ findUserById: vi.fn(), findUsersById: vi.fn() }))

const user = { id: makeSbUserId(7), name: 'target', created: 0 }
const otherUser = { id: makeSbUserId(8), name: 'related', created: 0 }
const match = {
  userId: otherUser.id,
  matchingIdentifierTypes: [1, 2, 3, 6],
  firstUsed: new Date('2026-01-01T00:00:00Z'),
  lastUsed: new Date('2026-10-01T00:00:00Z'),
}
let server: Server
let baseUrl: string

beforeAll(async () => {
  const app = new Koa()
  const router = new Router()
  applyApiRoutes(router, new AdminUserApi({} as any, {} as any, {} as any, {} as any))
  app.use(async (ctx, next) => {
    const role = ctx.get('x-test-role')
    if (role) {
      ctx.session = { user, permissions: { banUsers: role === 'moderator' } } as any
    }
    await next()
  })
  app.use(router.routes()).use(router.allowedMethods())
  server = app.listen(0, '127.0.0.1')
  await new Promise<void>(resolve => server.once('listening', resolve))
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/1/admin/users`
})

afterAll(
  () => new Promise<void>((resolve, reject) => server.close(e => (e ? reject(e) : resolve()))),
)

beforeEach(() => {
  vi.resetAllMocks()
  asMockedFunction(findUserById).mockResolvedValue(user)
  asMockedFunction(findUsersById).mockResolvedValue([otherUser])
  asMockedFunction(findLinkedAccounts).mockResolvedValue([match])
})

function request(suffix = '7/linked-accounts', role = 'moderator') {
  return got(`${baseUrl}/${suffix}`, {
    headers: { 'x-test-role': role },
    throwHttpErrors: false,
    retry: { limit: 0 },
  })
}

test.each([
  ['', 401],
  ['user', 403],
])('requires a moderator session (%s)', async (role, status) => {
  const response = await request(undefined, role as string)
  expect(response.statusCode).toBe(status)
  expect(findUserById).not.toHaveBeenCalled()
  expect(findLinkedAccounts).not.toHaveBeenCalled()
})

test('returns bounded direct matches and usage dates without identifier hashes', async () => {
  const response = await request()
  expect(response.statusCode).toBe(200)
  expect(response.headers['cache-control']).toBe('private, no-store')
  expect(JSON.parse(response.body)).toEqual({
    forUser: user.id,
    matches: [{ ...match, firstUsed: Number(match.firstUsed), lastUsed: Number(match.lastUsed) }],
    users: [otherUser, user],
    hasMore: false,
  })
  expect(findLinkedAccounts).toHaveBeenCalledWith(user.id, 4, 51, 0)
  expect(findUsersById).toHaveBeenCalledWith([otherUser.id])
})

test('supports weaker-match filtering and pagination without returning the lookahead row', async () => {
  const rows = Array.from({ length: 51 }, (_, i) => ({ ...match, userId: makeSbUserId(i + 20) }))
  asMockedFunction(findLinkedAccounts).mockResolvedValue(rows)
  const response = await request('7/linked-accounts?minMatches=2&offset=50')
  const body: AdminGetLinkedAccountsResponse = JSON.parse(response.body)
  expect(response.statusCode).toBe(200)
  expect(body.hasMore).toBe(true)
  expect(body.matches).toHaveLength(50)
  expect(findLinkedAccounts).toHaveBeenCalledWith(user.id, 2, 51, 50)
  expect(findUsersById).toHaveBeenCalledWith(rows.slice(0, 50).map(r => r.userId))
})

test('returns an empty page without fetching an empty batch of users', async () => {
  asMockedFunction(findLinkedAccounts).mockResolvedValue([])
  const response = await request()
  expect(JSON.parse(response.body)).toEqual({
    forUser: user.id,
    matches: [],
    users: [user],
    hasMore: false,
  })
  expect(findUsersById).not.toHaveBeenCalled()
})

test('rejects unknown users before searching identifiers', async () => {
  asMockedFunction(findUserById).mockResolvedValue(undefined)
  expect((await request()).statusCode).toBe(404)
  expect(findLinkedAccounts).not.toHaveBeenCalled()
})

test.each([
  'bad/linked-accounts',
  '7/linked-accounts?minMatches=0',
  '7/linked-accounts?minMatches=9',
  '7/linked-accounts?minMatches=1.5',
  '7/linked-accounts?offset=-1',
  '7/linked-accounts?offset=1.5',
])('rejects invalid input: %s', async suffix => {
  expect((await request(suffix)).statusCode).toBe(400)
  expect(findLinkedAccounts).not.toHaveBeenCalled()
})
