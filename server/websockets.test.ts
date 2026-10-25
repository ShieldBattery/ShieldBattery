import { register } from '@prometheus-io/client'
import { IncomingMessage } from 'http'
import Koa from 'koa'
import { EventEmitter } from 'node:events'
import { beforeEach, expect, test, vi } from 'vitest'
import { makeSbUserId } from '../common/users/sb-user-id'
import { authorizeDevelopmentClients } from './lib/users/development-clients'
import { RequestSessionLookup } from './lib/websockets/session-lookup'
import { WebsocketServer } from './websockets'

vi.mock('./lib/lobbies/lobby-socket-api', () => ({ default: vi.fn() }))
vi.mock('./lib/users/development-clients', () => ({ authorizeDevelopmentClients: vi.fn() }))

beforeEach(() => {
  register.clear()
  vi.resetAllMocks()
})

function setup(existing?: { clientType: string; developmentClient: boolean }, loggedIn = true) {
  const lookup = new RequestSessionLookup()
  const nydus = Object.assign(new EventEmitter(), { setAllowRequestHandler: vi.fn() })
  const server = new WebsocketServer(
    new Koa(),
    nydus as any,
    async ctx => {
      if (loggedIn) ctx.state.jwtData = { sessionId: 'session' }
    },
    async ctx => {
      if (loggedIn) ctx.session = { user: { id: makeSbUserId(1), name: 'tester' } } as any
    },
    lookup,
    { getById: () => existing, clients: new Map() } as any,
    { users: new Map() } as any,
  )
  const request = (development: boolean, electron = true) =>
    ({
      method: 'GET',
      url: `/socket.io?clientId=test${development ? '&developmentClient=true' : ''}`,
      headers: {
        host: 'localhost',
        origin: electron ? 'shieldbattery://app' : 'https://example.test',
      },
      socket: { remoteAddress: '127.0.0.1' },
      connection: { remoteAddress: '127.0.0.1' },
    }) as unknown as IncomingMessage
  return { server, lookup, request }
}

test('only explicitly requested, authorized app connections get development mode', async () => {
  const { server, lookup, request } = setup()
  for (const development of [true, false]) {
    const req = request(development)
    const callback = vi.fn()
    await server.onAuthorization(req, callback)
    expect(callback).toHaveBeenCalledWith(null, true)
    expect(lookup.get(req)?.developmentClient).toBe(development)
  }
  expect(authorizeDevelopmentClients).toHaveBeenCalledExactlyOnceWith([makeSbUserId(1)])
})

test('denies a requested exception if permission was not granted', async () => {
  vi.mocked(authorizeDevelopmentClients).mockRejectedValue(new Error('permission denied'))
  const { server, lookup, request } = setup()
  const req = request(true)
  const callback = vi.fn()
  await server.onAuthorization(req, callback)
  expect(callback).toHaveBeenCalledWith(null, false)
  expect(lookup.get(req)).toBeUndefined()
})

test('web requests cannot request development mode', async () => {
  const { server, request } = setup()
  const callback = vi.fn()
  await server.onAuthorization(request(true, false), callback)
  expect(callback).toHaveBeenCalledWith(null, false)
  expect(authorizeDevelopmentClients).not.toHaveBeenCalled()
})

test('development mode does not bypass authentication', async () => {
  const { server, request } = setup(undefined, false)
  const callback = vi.fn()
  await server.onAuthorization(request(true), callback)
  expect(callback).toHaveBeenCalledWith(null, false)
  expect(authorizeDevelopmentClients).not.toHaveBeenCalled()
})

test.each([false, true])('cannot change an existing client mode from %s', async development => {
  const { server, request } = setup({ clientType: 'electron', developmentClient: development })
  const callback = vi.fn()
  await server.onAuthorization(request(!development), callback)
  expect(callback).toHaveBeenCalledWith(null, false)
})
