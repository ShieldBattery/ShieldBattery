import { Map, Set } from 'immutable'
import { EventEmitter } from 'events'
import { updateOrInsertUserIp } from '../models/user-ips'
import getAddress from './get-address'

function defaultDataGetter() {}

class SocketGroup extends EventEmitter {
  constructor(nydus, session, initSocket) {
    super()
    this.nydus = nydus
    this.name = session.userName
    this.session = session
    this.sockets = new Set()
    this.subscriptions = new Map()

    if (initSocket) {
      this.add(initSocket)
    }
  }

  add(socket) {
    const newSockets = this.sockets.add(socket)
    if (newSockets !== this.sockets) {
      this.sockets = newSockets
      socket.once('close', () => this.delete(socket))
      this._applySubscriptions(socket)
      this.emit('connection', this, socket)
    }
  }

  delete(socket) {
    this.sockets = this.sockets.delete(socket)
    if (this.sockets.isEmpty()) {
      this._applyCleanups()
      this.emit('close', this)
    }
  }

  closeAll() {
    for (const s of this.sockets) {
      s.close()
    }
  }

  // Adds a subscription to all sockets for this socket group, including any sockets that may
  // connect after this. `initialDataGetter` should either be undefined, or a
  // function(socketGroup, socket) that returns the initialData to use for a subscribe call.
  // `cleanup` should either be null/undefined, or a function(socketGroup) that will be called when
  // every socket in the socket group has disconnected.
  subscribe(path, initialDataGetter = defaultDataGetter, cleanup) {
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

  _applySubscriptions(socket) {
    for (const [path, { getter }] of this.subscriptions.entries()) {
      this.nydus.subscribeClient(socket, path, getter(this, socket))
    }

    // Give the client a message so they know we're done subscribing them to things
    this.nydus.subscribeClient(socket, this.getPath(), { type: this.getType() })

    // Subscribe the client to the their profile path, so they can receive an update in case their
    // profile changes
    this.nydus.subscribeClient(socket, '/userProfiles/' + this.session.userId)
  }

  _applyCleanups() {
    for (const { cleanup } of this.subscriptions.values()) {
      if (cleanup) cleanup(this)
    }
  }

  unsubscribe(path) {
    const updated = this.subscriptions.delete(path)
    if (updated === this.subscriptions) return

    for (const socket of this.sockets) {
      this.nydus.unsubscribeClient(socket, path)
    }
    this.subscriptions = updated
  }
}

export class UserSocketsGroup extends SocketGroup {
  constructor(nydus, session, socket) {
    super(nydus, session, socket)
  }

  getPath() {
    return `/users/${this.session.userId}`
  }

  getType() {
    return 'subscribedUser'
  }
}

export class ClientSocketsGroup extends SocketGroup {
  constructor(nydus, session, socket) {
    super(nydus, session, socket)
    this.userId = session.userId
    this.clientId = session.clientId
  }

  getPath() {
    return `/clients/${this.userId}/${this.session.clientId}`
  }

  getType() {
    return 'subscribedClient'
  }
}

export class UserManager extends EventEmitter {
  constructor(nydus, sessionLookup) {
    super()
    this.nydus = nydus
    this.sessionLookup = sessionLookup
    this.users = new Map()
    this.nydus.on('connection', socket => {
      const session = this.sessionLookup.get(socket.conn.request)
      const userName = session.userName
      if (!this.users.has(userName)) {
        const user = new UserSocketsGroup(this.nydus, session, socket)
        this.users = this.users.set(userName, user)
        this.emit('newUser', user)
        user.once('close', () => this._removeUser(userName))
      } else {
        this.users.get(userName).add(socket)
      }

      updateOrInsertUserIp(session.userId, getAddress(socket.conn.request)).catch(() => {
        // Can't log without creating a context here, so we just drop these. Bleh.
      })
    })
  }

  getByName(name) {
    return this.users.get(name)
  }

  getBySocket(socket) {
    const name = this.sessionLookup.get(socket.conn.request).userName
    return this.getByName(name)
  }

  _removeUser(userName) {
    this.users = this.users.delete(userName)
    this.emit('userQuit', userName)
    return this
  }
}

export class ClientManager extends EventEmitter {
  constructor(nydus, sessionLookup) {
    super()
    this.nydus = nydus
    this.sessionLookup = sessionLookup
    this.clients = new Map()
    this.nydus.on('connection', socket => {
      const session = this.sessionLookup.get(socket.conn.request)
      const userClientId = `${session.userId}|${session.clientId}`
      if (!this.clients.has(userClientId)) {
        const client = new ClientSocketsGroup(this.nydus, session, socket)
        this.clients = this.clients.set(userClientId, client)
        client.once('close', () => this._removeClient(userClientId))
      } else {
        this.clients.get(userClientId).add(socket)
      }
    })
  }

  getCurrentClient(socket) {
    const session = this.sessionLookup.get(socket.conn.request)
    const userClientId = `${session.userId}|${session.clientId}`
    return this.clients.get(userClientId)
  }

  _removeClient(userClientId) {
    this.clients = this.clients.delete(userClientId)
    return this
  }
}

export function createUserSockets(nydus, sessionLookup) {
  return new UserManager(nydus, sessionLookup)
}

export function createClientSockets(nydus, sessionLookup) {
  return new ClientManager(nydus, sessionLookup)
}
