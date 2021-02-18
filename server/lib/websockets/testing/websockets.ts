import cuid from 'cuid'
import eio from 'engine.io'
import { EventEmitter } from 'events'
import { IncomingMessage } from 'http'
import { Map as IMap } from 'immutable'
import { NydusClient, NydusServer, RouteHandler } from 'nydus'
import { RequestSessionLookup, SessionInfo } from '../session-lookup'

// Used to auto-increment for easy value comparison in tests
let clientIdCounter = 0

export class FakeNydusServer
  extends EventEmitter
  implements Omit<Pick<NydusServer, keyof NydusServer>, keyof EventEmitter> {
  clients: IMap<string, NydusClient> = IMap()

  attach() {}
  close() {}
  setIdGen() {}

  registerRoute(pathPattern: string, ...handlers: RouteHandler[]) {}

  subscribeClient = jest.fn()
  // TODO(tec27): Make this return value correct?
  unsubscribeClient = jest.fn(() => false)
  // TODO(tec27): Make this return value correct?
  unsubscribeAll = jest.fn(() => false)
  publish = jest.fn()

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
  return (new FakeNydusServer() as any) as NydusServer
}

export class NydusConnector {
  private fakeNydus: FakeNydusServer

  constructor(readonly nydus: NydusServer, readonly sessionLookup: RequestSessionLookup) {
    if (!(nydus instanceof FakeNydusServer)) {
      throw new Error('Must use a FakeNydusServer')
    }
    this.fakeNydus = nydus
  }

  connectClient(user: { id: number; name: string }, clientId: string): NydusClient {
    const id = String(clientIdCounter++)
    const fakeRequest = ({
      headers: [],
      connection: {
        remoteAddress: '127.0.0.1',
      },
    } as any) as IncomingMessage
    const fakeSession: SessionInfo = {
      sessionId: cuid(),
      userId: user.id,
      userName: user.name,
      clientId,
      address: '127.0.0.1',
    }
    this.sessionLookup.set(fakeRequest, fakeSession)
    const client = new NydusClient(
      id,
      ({
        id,
        request: fakeRequest,
        on() {
          return this
        },
      } as any) as eio.Socket,
      () => {},
      () => {},
    )

    this.fakeNydus.testonlyAddClient(client)

    return client
  }
}
