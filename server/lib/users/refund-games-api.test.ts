import Router from '@koa/router'
import got from 'got'
import Koa from 'koa'
import { Server } from 'node:http'
import { AddressInfo } from 'node:net'
import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest'
import { asMockedFunction } from '../../../common/testing/mocks'
import { makeSbUserId } from '../../../common/users/sb-user-id'
import { applyApiRoutes } from '../http/http-api'
import { AdminUserApi } from './user-api'
import { findUserById } from './user-model'

vi.mock('../mail/mailer', () => ({ sendMailTemplate: vi.fn() }))
vi.mock('./user-model', () => ({ findUserById: vi.fn(), findUsersById: vi.fn() }))

const admin = { id: makeSbUserId(1), name: 'admin', created: 0 }
const target = { id: makeSbUserId(7), name: 'cheater', created: 0 }
const summary = { refundedGames: 3, skippedGames: 1, failedGames: 0 }
const refundService = { refundUserGames: vi.fn() }
let server: Server
let baseUrl: string

beforeAll(async () => {
  const app = new Koa()
  const router = new Router()
  applyApiRoutes(router, new AdminUserApi({} as any, refundService as any, {} as any, {} as any))
  app.use(async (ctx, next) => {
    const role = ctx.get('x-test-role')
    if (role) {
      ctx.session = {
        user: admin,
        permissions: { banUsers: true, manageGameReports: role === 'admin' },
      } as any
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
  asMockedFunction(findUserById).mockResolvedValue(target)
  refundService.refundUserGames.mockResolvedValue(summary)
})

function request(role = 'admin', userId = '7') {
  return got.post(`${baseUrl}/${userId}/refund-games`, {
    headers: { 'x-test-role': role },
    throwHttpErrors: false,
    retry: { limit: 0 },
  })
}

test.each([
  ['', 401],
  ['moderator', 403],
])('requires the manageGameReports permission (%s)', async (role, status) => {
  expect((await request(role)).statusCode).toBe(status)
  expect(refundService.refundUserGames).not.toHaveBeenCalled()
})

test("refunds the user's games as the requesting admin and returns the summary", async () => {
  const response = await request()
  expect(response.statusCode).toBe(200)
  expect(JSON.parse(response.body)).toEqual(summary)
  expect(refundService.refundUserGames).toHaveBeenCalledWith({
    userId: target.id,
    refundedBy: admin.id,
  })
})

test('rejects unknown users before refunding anything', async () => {
  asMockedFunction(findUserById).mockResolvedValue(undefined)
  expect((await request()).statusCode).toBe(404)
  expect(refundService.refundUserGames).not.toHaveBeenCalled()
})

test('rejects invalid user ids', async () => {
  expect((await request('admin', 'bad')).statusCode).toBe(400)
  expect(refundService.refundUserGames).not.toHaveBeenCalled()
})
