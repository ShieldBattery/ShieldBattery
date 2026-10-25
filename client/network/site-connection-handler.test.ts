import { EventEmitter } from 'node:events'
import { NydusClient, RouteHandler } from 'nydus-client'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { TypedIpcRenderer } from '../../common/ipc'
import { siteConnectionPath } from '../../common/websockets'
import { dispatch } from '../dispatch-registry'
import { jotaiStore } from '../jotai-store'
import { showConnectionRefused } from './connection-refused-dialog'
import { isConnectedAtom, nextSiteConnectionState, siteConnectionAtom } from './network-atoms'
import siteConnectionHandler from './site-connection-handler'

vi.mock('../dispatch-registry', () => ({ dispatch: vi.fn() }))
vi.mock('./connection-refused-dialog', () => ({ showConnectionRefused: vi.fn() }))
vi.mock('../logging/logger', () => ({
  default: { verbose: vi.fn(), error: vi.fn(), warning: vi.fn() },
}))

class FakeSiteSocket extends EventEmitter {
  routes = new Map<string, RouteHandler>()
  disconnect = vi.fn()

  registerRoute(pattern: string, handler: RouteHandler) {
    this.routes.set(pattern, handler)
  }

  publish(pattern: string, data: unknown) {
    this.routes.get(pattern)!({ route: pattern, params: {}, splats: [] } as any, data)
  }

  connectionEvent(data: unknown) {
    this.publish(siteConnectionPath(':socketId'), data)
  }
}

let socket: FakeSiteSocket
let ipcRenderer: { send: ReturnType<typeof vi.fn> }

function status() {
  return jotaiStore.get(siteConnectionAtom).status
}

beforeEach(() => {
  vi.clearAllMocks()
  jotaiStore.set(siteConnectionAtom, { status: 'disconnected', since: 0 })
  socket = new FakeSiteSocket()
  ipcRenderer = { send: vi.fn() }
  siteConnectionHandler({
    siteSocket: socket as unknown as NydusClient,
    ipcRenderer: ipcRenderer as unknown as TypedIpcRenderer,
  })
})

test('a connected socket only counts as connected once admitted', () => {
  socket.emit('connect')
  expect(status()).toBe('admitting')
  expect(jotaiStore.get(isConnectedAtom)).toBe(false)
  expect(dispatch).not.toHaveBeenCalled()

  socket.connectionEvent({ type: 'admitted' })
  expect(status()).toBe('connected')
  expect(jotaiStore.get(isConnectedAtom)).toBe(true)
  expect(dispatch).toHaveBeenCalledExactlyOnceWith({ type: '@network/connect' })
})

test('checks for updates as soon as the socket connects', () => {
  socket.emit('connect')
  expect(ipcRenderer.send).toHaveBeenCalledWith('networkSiteConnected')
})

test('disconnect actions only follow a connect action', () => {
  socket.emit('connect')
  socket.emit('disconnect', 'transport close')
  expect(status()).toBe('disconnected')
  expect(dispatch).not.toHaveBeenCalled()

  socket.emit('connect')
  socket.connectionEvent({ type: 'admitted' })
  socket.emit('disconnect', 'transport close')
  expect(vi.mocked(dispatch).mock.calls).toEqual([
    [{ type: '@network/connect' }],
    [{ type: '@network/disconnect' }],
  ])
})

test('refusal is final', () => {
  socket.emit('connect')
  socket.connectionEvent({ type: 'refused', reason: 'clientUpdate' })
  expect(status()).toBe('refused')
  expect(jotaiStore.get(siteConnectionAtom).refusal).toBe('clientUpdate')
  expect(showConnectionRefused).toHaveBeenCalledExactlyOnceWith('clientUpdate')
  expect(socket.disconnect).toHaveBeenCalled()

  socket.emit('disconnect', 'io client disconnect')
  socket.emit('connect')
  socket.connectionEvent({ type: 'admitted' })
  expect(status()).toBe('refused')
  expect(dispatch).not.toHaveBeenCalled()
})

test('failed verification explains what to do', () => {
  socket.emit('connect')
  socket.connectionEvent({ type: 'refused', reason: 'clientVerification' })
  expect(status()).toBe('refused')
  expect(showConnectionRefused).toHaveBeenCalledExactlyOnceWith('clientVerification')
})

test('older servers admit sockets by subscribing them to their client', () => {
  socket.emit('connect')
  socket.publish('/clients/:userId/:clientId', { type: 'subscribedClient' })
  expect(status()).toBe('connected')
})

test('admission is ignored when not connected', () => {
  socket.connectionEvent({ type: 'admitted' })
  expect(status()).toBe('disconnected')
})

describe('nextSiteConnectionState', () => {
  test('tracks when the connection last became available or unavailable', () => {
    let state = nextSiteConnectionState({ status: 'disconnected', since: 0 }, 'admitting', 10)
    expect(state).toEqual({ status: 'admitting', since: 0 })
    state = nextSiteConnectionState(state, 'connected', 20)
    expect(state).toEqual({ status: 'connected', since: 20 })
    state = nextSiteConnectionState(state, 'disconnected', 30)
    expect(state).toEqual({ status: 'disconnected', since: 30 })
    state = nextSiteConnectionState(state, 'admitting', 40)
    expect(state).toEqual({ status: 'admitting', since: 30 })
    state = nextSiteConnectionState(state, 'refused', 50)
    expect(state).toEqual({ status: 'refused', since: 30 })
  })
})
