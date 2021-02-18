import { EventEmitter } from 'events'
import { Map, Set } from 'immutable'
import { NydusClient, NydusServer } from 'nydus'
import { container, inject, singleton } from 'tsyringe'
import log from '../logging/logger'
import { UpdateOrInsertUserIp } from '../network/user-ips-type'
import getAddress from './get-address'
import { RequestSessionLookup, SessionInfo } from './session-lookup'

type DataGetter<T> = (socketGroup: T, socket: NydusClient) => unknown
type CleanupFunc<T> = (socketGroup: T) => void

interface SubscriptionInfo<T> {
  getter: DataGetter<T>
  cleanup: CleanupFunc<T> | undefined
}

const defaultDataGetter: DataGetter<any> = () => {}

// TODO(tec27): type the events this emits
abstract class SocketGroup extends EventEmitter {
  readonly name: string
  sockets = Set<NydusClient>()
  subscriptions = Map<string, Readonly<SubscriptionInfo<this>>>()

  constructor(private nydus: NydusServer, readonly session: SessionInfo) {
    super()
    this.name = session.userName
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
      this.emit('connection', this, socket)
    }
  }

  delete(socket: NydusClient) {
    this.sockets = this.sockets.delete(socket)
    if (this.sockets.isEmpty()) {
      this.applyCleanups()
      this.emit('close', this)
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
  subscribe(
    path: string,
    initialDataGetter: (
      socketGroup: SocketGroup,
      socket: NydusClient,
    ) => unknown = defaultDataGetter,
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

export class UserSocketsGroup extends SocketGroup {
  getPath() {
    return `/users/${this.session.userId}`
  }

  getType() {
    return 'subscribedUser'
  }
}

export class ClientSocketsGroup extends SocketGroup {
  readonly userId: number
  readonly clientId: string

  constructor(nydus: NydusServer, session: SessionInfo) {
    super(nydus, session)
    this.userId = session.userId
    this.clientId = session.clientId
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
  users = Map<string, UserSocketsGroup>()

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
      const session = this.sessionLookup.get(socket.conn.request)
      if (!session) {
        log.error({ req: socket.conn.request }, "couldn't find a session for the request")
        return
      }

      const userName: string = session.userName
      if (!this.users.has(userName)) {
        const user = new UserSocketsGroup(this.nydus, session!)
        user.add(socket)
        this.users = this.users.set(userName, user)
        this.emit('newUser', user)
        user.once('close', () => this.removeUser(userName))
      } else {
        this.users.get(userName)!.add(socket)
      }

      this.updateOrInsertUserIp(session.userId, getAddress(socket.conn.request)).catch(() => {
        log.error({ req: socket.conn.request }, 'failed to save user IP address')
      })
    })
  }

  getByName(name: string) {
    return this.users.get(name)
  }

  getBySocket(socket: NydusClient) {
    const session = this.sessionLookup.get(socket.conn.request)
    if (!session) {
      log.error({ req: socket.conn.request }, "couldn't find a session for the request")
      return undefined
    }

    return this.getByName(session.userName)
  }

  private removeUser(userName: string) {
    this.users = this.users.delete(userName)
    this.emit('userQuit', userName)
    return this
  }
}

@singleton()
export class ClientSocketsManager extends EventEmitter {
  clients = Map<string, ClientSocketsGroup>()

  constructor(private nydus: NydusServer, private sessionLookup: RequestSessionLookup) {
    super()
    this.nydus.on('connection', socket => {
      const session = this.sessionLookup.get(socket.conn.request)
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
      } else {
        this.clients.get(userClientId)!.add(socket)
      }
    })
  }

  getCurrentClient(socket: NydusClient): ClientSocketsGroup | undefined {
    const session = this.sessionLookup.get(socket.conn.request)
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
    this.clients = this.clients.delete(userClientId)
    return this
  }
}
