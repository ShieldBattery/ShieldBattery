import { EventEmitter } from 'events'
import { Map, Set } from 'immutable'
import { NydusClient, NydusServer } from 'nydus'
import { container, inject, singleton } from 'tsyringe'
import { TypedEventEmitter } from '../../../common/typed-emitter'
import log from '../logging/logger'
import { UpdateOrInsertUserIp } from '../network/user-ips-type'
import getAddress from './get-address'
import { RequestSessionLookup, SessionInfo } from './session-lookup'

export type DataGetter<T, D> = (socketGroup: T, socket: NydusClient) => D | Promise<D>
export type CleanupFunc<T> = (socketGroup: T) => void

interface SubscriptionInfo<T> {
  getter: DataGetter<T, any>
  cleanup: CleanupFunc<T> | undefined
}

const defaultDataGetter: DataGetter<any, any> = () => {}

interface SocketGroupEvents<T> {
  connection: (group: T, socket: NydusClient) => void
  close: (group: T) => void
}

abstract class SocketGroup<T> extends TypedEventEmitter<SocketGroupEvents<T>> {
  readonly name: string
  readonly userId: number
  sockets = Set<NydusClient>()
  subscriptions = Map<string, Readonly<SubscriptionInfo<this>>>()

  constructor(private nydus: NydusServer, readonly session: SessionInfo) {
    super()
    this.name = session.userName
    this.userId = session.userId
  }

  /**
   * Returns the Nydus path corresponding to this socket group. Publishes to this path will go to
   * every socket in the group.
   */
  abstract getPath(): string
  /**
   * Returns a string representing the type of this group. This will be used in the notification to
   * the socket when it first connects so that it knows it's part of a particular type of group.
   */
  abstract getType(): string

  add(socket: NydusClient) {
    const newSockets = this.sockets.add(socket)
    if (newSockets !== this.sockets) {
      this.sockets = newSockets
      socket.once('close', () => this.delete(socket))
      this.applySubscriptions(socket)
      this.emit('connection', this as any, socket)
    }
  }

  delete(socket: NydusClient) {
    this.sockets = this.sockets.delete(socket)
    if (this.sockets.isEmpty()) {
      this.applyCleanups()
      this.emit('close', this as any)
    }
  }

  closeAll() {
    for (const s of this.sockets) {
      s.close()
    }
  }

  /**
   * Adds a subscription to all sockets for this socket group, including any sockets that may
   * connect after this. `initialDataGetter` should either be undefined, or a
   * function(socketGroup, socket) that returns the initialData to use for a subscribe call.
   * `cleanup` should either be null/undefined, or a function(socketGroup) that will be called when
   * every socket in the socket group has disconnected.
   */
  subscribe<T = unknown>(
    path: string,
    initialDataGetter: DataGetter<this, T> = defaultDataGetter,
    cleanup?: (socketGroup: this) => void,
  ) {
    if (this.subscriptions.has(path)) {
      throw new Error('duplicate persistent subscription: ' + path)
    }

    this.subscriptions = this.subscriptions.set(path, {
      getter: initialDataGetter,
      cleanup,
    })
    for (const socket of this.sockets) {
      this.nydus.subscribeClient(socket, path, initialDataGetter(this, socket))
    }
  }

  private applySubscriptions(socket: NydusClient) {
    for (const [path, { getter }] of this.subscriptions.entries()) {
      this.nydus.subscribeClient(socket, path, getter(this, socket))
    }

    // Give the client a message so they know we're done subscribing them to things
    this.nydus.subscribeClient(socket, this.getPath(), { type: this.getType() })

    // Subscribe the client to the their profile path, so they can receive an update in case their
    // profile changes
    this.nydus.subscribeClient(socket, '/userProfiles/' + this.session.userId)
  }

  private applyCleanups() {
    for (const { cleanup } of this.subscriptions.values()) {
      if (cleanup) cleanup(this)
    }
  }

  unsubscribe(path: string) {
    const updated = this.subscriptions.delete(path)
    if (updated === this.subscriptions) return

    for (const socket of this.sockets) {
      this.nydus.unsubscribeClient(socket, path)
    }
    this.subscriptions = updated
  }
}

export class UserSocketsGroup extends SocketGroup<UserSocketsGroup> {
  getPath() {
    return `/users/${this.userId}`
  }

  getType() {
    return 'subscribedUser'
  }
}

export class ClientSocketsGroup extends SocketGroup<ClientSocketsGroup> {
  readonly clientId: string
  readonly clientType: 'electron' | 'web'

  constructor(nydus: NydusServer, session: SessionInfo) {
    super(nydus, session)
    this.clientId = session.clientId
    this.clientType = session.clientType
  }

  getPath() {
    return `/clients/${this.userId}/${this.clientId}`
  }

  getType() {
    return 'subscribedClient'
  }
}

// TODO(tec27): type the events emitted
@singleton()
export class UserSocketsManager extends EventEmitter {
  users = Map<number, UserSocketsGroup>()

  constructor(
    private nydus: NydusServer,
    private sessionLookup: RequestSessionLookup,
    @inject('updateOrInsertUserIp') private updateOrInsertUserIp: UpdateOrInsertUserIp,
  ) {
    super()

    // NOTE(tec27): This isn't really used, but it ensures ClientSocketsManager is always created
    // and registers it's event handlers *before* UserSocketsManager, so that events fire in a
    // consistent order
    container.resolve(ClientSocketsManager)

    this.nydus.on('connection', socket => {
      const session = this.sessionLookup.fromSocket(socket)
      if (!session) {
        log.error({ req: socket.conn.request }, "couldn't find a session for the request")
        return
      }

      const userId = session.userId
      if (!this.users.has(userId)) {
        const user = new UserSocketsGroup(this.nydus, session!)
        user.add(socket)
        this.users = this.users.set(userId, user)
        user.once('close', () => this.removeUser(userId))
        this.emit('newUser', user)
      } else {
        this.users.get(userId)!.add(socket)
      }

      this.updateOrInsertUserIp(userId, getAddress(socket.conn.request)).catch(() => {
        log.error({ req: socket.conn.request }, 'failed to save user IP address')
      })
    })
  }

  getById(userId: number) {
    return this.users.get(userId)
  }

  getBySocket(socket: NydusClient) {
    const session = this.sessionLookup.get(socket.conn.request)
    if (!session) {
      log.error({ req: socket.conn.request }, "couldn't find a session for the request")
      return undefined
    }

    return this.getById(session.userId)
  }

  private removeUser(userId: number) {
    this.users = this.users.delete(userId)
    this.emit('userQuit', userId)
    return this
  }
}

interface ClientSocketsManagerEvents {
  newClient: (client: ClientSocketsGroup) => void
  clientQuit: (client: ClientSocketsGroup) => void
}

@singleton()
export class ClientSocketsManager extends TypedEventEmitter<ClientSocketsManagerEvents> {
  clients = Map<string, ClientSocketsGroup>()

  constructor(private nydus: NydusServer, private sessionLookup: RequestSessionLookup) {
    super()
    this.nydus.on('connection', socket => {
      const session = this.sessionLookup.fromSocket(socket)
      if (!session) {
        log.error({ req: socket.conn.request }, "couldn't find a session for the request")
        return
      }

      const userClientId = this.keyFor(session.userId, session.clientId)
      if (!this.clients.has(userClientId)) {
        const client = new ClientSocketsGroup(this.nydus, session)
        client.add(socket)
        this.clients = this.clients.set(userClientId, client)
        client.once('close', () => this.removeClient(userClientId))
        this.emit('newClient', client)
      } else {
        this.clients.get(userClientId)!.add(socket)
      }
    })
  }

  getCurrentClient(socket: NydusClient): ClientSocketsGroup | undefined {
    const session = this.sessionLookup.fromSocket(socket)
    if (!session) {
      log.error({ req: socket.conn.request }, "couldn't find a session for the request")
      return undefined
    }

    const userClientId = this.keyFor(session.userId, session.clientId)
    return this.clients.get(userClientId)
  }

  getById(userId: number, clientId: string): ClientSocketsGroup | undefined {
    return this.clients.get(this.keyFor(userId, clientId))
  }

  private keyFor(userId: number, clientId: string) {
    return `${userId}|${clientId}`
  }

  private removeClient(userClientId: string) {
    if (this.clients.has(userClientId)) {
      const client = this.clients.get(userClientId)!
      this.clients = this.clients.delete(userClientId)
      this.emit('clientQuit', client)
    }
    return this
  }
}
