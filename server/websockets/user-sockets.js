import { List, Map, Set } from 'immutable'
import { EventEmitter } from 'events'

function defaultDataGetter() {}

export class UserSocketGroup extends EventEmitter {
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
      this.emit('close', this)
      this._applyCleanups()
    }
  }

  // Adds a subscription to all sockets for this user, including any sockets that may connect
  // after this. `initialDataGetter` should either be undefined, or a function(user, socket)
  // that returns the initialData to use for a subscribe call. `cleanup` should either be
  // null/undefined, or a function(user) that will be called when the user has disconnected
  // completely.
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
    this.nydus.subscribeClient(socket, this.getUserPath(), { type: 'subscribed' })
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

  getUserPath() {
    return `/users/${this.session.userId}`
  }
}

export class UserManager extends EventEmitter {
  constructor(nydus, sessionLookup) {
    super()
    this.nydus = nydus
    this.sessionLookup = sessionLookup
    this.users = new Map()
    this.newUserListeners = new List()
    this.nydus.on('connection', socket => {
      const session = this.sessionLookup.get(socket.conn.request)
      const userName = session.userName
      if (!this.users.has(userName)) {
        const user = new UserSocketGroup(this.nydus, session, socket)
        this.users = this.users.set(userName, user)
        this.emit('newUser', user)
        user.once('close', () => this._removeUser(userName))
      } else {
        this.users.get(userName).add(socket)
      }
    })
  }

  // Adds a listener for when new users connect to the server (users that had no other sockets
  // connected previously). Returns a function that can be used to unsubscribe the listener.
  addNewUserListener(listener) {
    this.newUserListeners = this.newUserListeners.push(listener)
    let called = false
    return () => {
      if (called) return
      called = true
      const index = this.newUserListeners.findIndex(l => l === listener)
      if (index >= 0) {
        this.newUserListeners = this.newUserListeners.delete(index)
      }
    }
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

export default function(nydus, sessionLookup) {
  return new UserManager(nydus, sessionLookup)
}
