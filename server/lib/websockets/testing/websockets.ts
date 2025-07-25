import eio from 'engine.io'
import { EventEmitter } from 'events'
import { IncomingMessage } from 'http'
import { Map as IMap } from 'immutable'
import { nanoid } from 'nanoid'
import { NydusClient, NydusServer, RouteHandler } from 'nydus'
import { vi } from 'vitest'
import { SbUser } from '../../../../common/users/sb-user'
import { RequestSessionLookup, SessionInfo } from '../session-lookup'

// Used to auto-increment for easy value comparison in tests
let clientIdCounter = 0

export class FakeNydusServer
  extends EventEmitter
  implements Omit<Pick<NydusServer, keyof NydusServer>, keyof EventEmitter>
{
  clients = IMap<string, NydusClient>()

  fakeSubscriptions = new Map<string, Set<InspectableNydusClient>>()

  attach() {}
  close() {}
  setIdGen() {}

  registerRoute(pathPattern: string, ...handlers: RouteHandler[]) {}

  subscribeClient = vi.fn((client: NydusClient, path: string, initialData?: any) => {
    if (!(client instanceof InspectableNydusClient)) {
      throw new Error(
        'Only InspectableNydusClients should be connected to FakeNydusServer. ' +
          'Use NydusConnector for connecting clients.',
      )
    }

    if (!this.fakeSubscriptions.has(path)) {
      this.fakeSubscriptions.set(path, new Set())
    }

    const subs = this.fakeSubscriptions.get(path)!
    if (!subs.has(client)) {
      subs.add(client)
      if (initialData) {
        if (typeof initialData.then === 'function') {
          // TODO(tec27): might need to handle disconnects here? probably only applies to very
          // complex test scenarios though
          initialData.then((data: any) => {
            if (data !== undefined) {
              client.publish(path, data)
            }
          })
        } else {
          client.publish(path, initialData)
        }
      }
    }
  })
  unsubscribeClient = vi.fn((client: NydusClient, path: string) => {
    const inspectableClient = client as InspectableNydusClient
    const unsubscribed = !!this.fakeSubscriptions.get(path)?.delete(inspectableClient)

    if (unsubscribed) {
      inspectableClient.unsubscribe(path)
    }

    return unsubscribed
  })
  unsubscribeAll = vi.fn((path: string) => {
    this.fakeSubscriptions.get(path)?.forEach(client => {
      client.unsubscribe(path)
    })
    return this.fakeSubscriptions.delete(path)
  })
  publish = vi.fn((path: string, data?: any) => {
    this.fakeSubscriptions.get(path)?.forEach(client => {
      client.publish(path, data)
    })
  })

  testonlyClear() {
    this.subscribeClient.mockClear()
    this.unsubscribeClient.mockClear()
    this.unsubscribeAll.mockClear()
    this.publish.mockClear()
  }

  testonlyAddClient(client: NydusClient) {
    this.clients = this.clients.set(client.id, client)
    this.emit('connection', client)
  }
}

/**
 * An extension of NydusClient that allows tests to check messages that were published to it (via
 * a mock).
 */
export class InspectableNydusClient extends NydusClient {
  // NOTE(tec27): We add an explicit type because it makes calling the method have better
  // documentation (the arguments are named, vs the arg_0, arg_1 stuff from mock typings)
  publish: (path: string, data: any) => void = vi.fn()
  unsubscribe: (path: string) => boolean = vi.fn()
  disconnect = vi.fn(() => this.emit('close', 'CLIENT_DISCONNECT'))
}

export function clearTestLogs(nydus: NydusServer) {
  if (!(nydus instanceof FakeNydusServer)) {
    throw new Error('Must use a FakeNydusServer')
  }
  nydus.testonlyClear()
}

export function createFakeNydusServer(): NydusServer {
  // NOTE(tec27): This is necessary because TS uses the private fields of a class when checking
  // whether something is assignable. This cast is "safe" because our implementation will never try
  // to use those private fields, and nobody else should be able to either due to the type system.
  return new FakeNydusServer() as any as NydusServer
}

export class NydusConnector {
  private fakeNydus: FakeNydusServer

  constructor(
    readonly nydus: NydusServer,
    readonly sessionLookup: RequestSessionLookup,
  ) {
    if (!(nydus instanceof FakeNydusServer)) {
      throw new Error('Must use a FakeNydusServer')
    }
    this.fakeNydus = nydus
  }

  connectClient(
    user: SbUser,
    clientId: string,
    clientType: 'web' | 'electron' = 'electron',
  ): InspectableNydusClient {
    const id = String(clientIdCounter++)
    const fakeRequest = {
      headers: [],
      connection: {
        remoteAddress: '127.0.0.1',
      },
    } as any as IncomingMessage
    const fakeSession: SessionInfo = {
      sessionId: nanoid(),
      userId: user.id,
      userName: user.name,
      clientId,
      address: '127.0.0.1',
      clientType,
    }
    this.sessionLookup.set(fakeRequest, fakeSession)
    const client = new InspectableNydusClient(
      id,
      {
        id,
        request: fakeRequest,
        on() {
          return this
        },
      } as any as eio.Socket,
      () => {},
      () => {},
      () => {},
    )

    this.fakeNydus.testonlyAddClient(client)

    return client
  }
}
