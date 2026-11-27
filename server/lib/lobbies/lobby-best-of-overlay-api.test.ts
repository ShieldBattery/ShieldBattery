import Router from '@koa/router'
import got from 'got'
import http from 'http'
import Koa from 'koa'
import { AddressInfo } from 'net'
import { container } from 'tsyringe'
import { afterEach, beforeEach, describe, expect, Mock, test, vi } from 'vitest'
import { makeSbUserId } from '../../../common/users/sb-user-id'
import { errorPayloadMiddleware } from '../errors/error-payload-middleware'
import { applyApiRoutes } from '../http/http-api'
import { Redis } from '../redis/redis'
import { LobbyBestOfOverlayApi } from './lobby-best-of-overlay-api'
import { LobbyBestOfOverlayService } from './lobby-best-of-overlay-service'

const HOST = makeSbUserId(1)

describe('lobbies/lobby-best-of-overlay-api', () => {
  let server: http.Server
  let baseUrl: string
  let getRememberedDisplayNames: Mock

  beforeEach(async () => {
    container.register(Redis, {
      useValue: { client: { sbThrottle: vi.fn(async () => [0, 0]) } } as unknown as Redis,
    })
    getRememberedDisplayNames = vi.fn(async () => [{ userId: makeSbUserId(2), name: 'Flash' }])
    const api = new LobbyBestOfOverlayApi({
      getRememberedDisplayNames,
    } as unknown as LobbyBestOfOverlayService)
    const router = new Router()
    applyApiRoutes(router, api)
    const app = new Koa()
    app.on('error', () => {})
    app
      .use(errorPayloadMiddleware())
      .use(async (ctx, next) => {
        ;(ctx as any).session = { user: { id: HOST } }
        await next()
      })
      .use(router.routes())
    const callback = app.callback()
    server = http.createServer((req, res) => {
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      callback(req, res)
    })
    await new Promise<void>(resolve => server.listen(0, resolve))
    baseUrl = `http://localhost:${(server.address() as AddressInfo).port}/api/1/lobby-best-of-overlay`
  })

  afterEach(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()))
  })

  function get(query: string) {
    return got.get(`${baseUrl}/display-names${query}`, {
      throwHttpErrors: false,
      retry: { limit: 0 },
      headers: { accept: 'application/json' },
    })
  }

  test("answers with the asking host's remembered display names for the ids asked about", async () => {
    const many = await get('?u=2&u=3')
    const one = await get('?u=2')

    expect(many.statusCode).toBe(200)
    expect(JSON.parse(many.body)).toEqual({ displayNames: [{ userId: 2, name: 'Flash' }] })
    expect(one.statusCode).toBe(200)
    expect(getRememberedDisplayNames.mock.calls).toEqual([
      [HOST, [2, 3]],
      [HOST, [2]],
    ])
  })

  test('refuses no ids, repeated ids, malformed ids, or more than both sides hold', async () => {
    const seventeen = Array.from({ length: 17 }, (_, i) => `u=${i + 2}`).join('&')
    const sixteen = Array.from({ length: 16 }, (_, i) => `u=${i + 2}`).join('&')

    const responses = await Promise.all([
      get(''),
      get('?u=2&u=2'),
      get('?u=abc'),
      get('?u=0'),
      get(`?${seventeen}`),
    ])
    const ok = await get(`?${sixteen}`)

    expect(responses.map(response => response.statusCode)).toEqual([400, 400, 400, 400, 400])
    expect(ok.statusCode).toBe(200)
    expect(getRememberedDisplayNames).toHaveBeenCalledTimes(1)
  })
})
