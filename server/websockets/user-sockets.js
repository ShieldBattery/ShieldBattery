import SimpleMap from '../../shared/simple-map'
import { EventEmitter } from 'events'

class UserSocketSet extends EventEmitter {
  constructor(manager, userName, initSocket) {
    super()
    this.manager = manager
    this.userName = userName
    this._publishPath = '/users/' + encodeURIComponent(this.userName)
    this.sockets = initSocket ? [ initSocket ] : []

    if (initSocket) {
      initSocket.once('disconnect', () => this.del(initSocket))
    }
  }

  add(socket) {
    if (this.sockets.indexOf(socket) !== -1) {
      return
    }

    this.sockets.push(socket)
    socket.once('disconnect', () => this.del(socket))
    this.emit('connection', socket)
  }

  del(socket) {
    const index = this.sockets.indexOf(socket)
    if (index === -1) {
      return
    }

    this.sockets.splice(index, 1)
    if (!this.sockets.length) {
      this.emit('disconnect')
    }
  }

  publish(type, data) {
    this.manager.nydus.publish(this._publishPath, { type, data })
    return this
  }

  publishTo(socket, type, data) {
    socket.publish(this._publishPath, { type, data })
    return this
  }

  revoke(topicPath) {
    this.manager.nydus.revoke(this.sockets, topicPath)
  }
}

class UserManager extends EventEmitter {
  constructor(nydus) {
    super()
    this.nydus = nydus
    this.users = new SimpleMap()

    this.nydus.on('connection', socket => {
      const userName = socket.handshake.userName
      if (!this.users.has(userName)) {
        const user = new UserSocketSet(this, userName, socket)
        this.users.put(userName, user)
        this.emit('newUser', user)

        user.once('disconnect', () => this._removeUser(userName))
      } else {
        this.users.get(userName).add(socket)
      }
    })

    this.nydus.router.subscribe('/users/:user', (req, res) => {
      if (req.socket.handshake.userName !== req.params.user) {
        return res.fail(403, 'forbidden',
            { msg: 'You can only subscribe to your own user channel' })
      }

      res.complete()
      const user = this.get(req.socket)
      user.emit('subscribe', user, req.socket)
    })
  }

  get(nameOrSocket) {
    let name
    if (typeof nameOrSocket == 'string') {
      name = nameOrSocket
    } else if (nameOrSocket && nameOrSocket.handshake && nameOrSocket.handshake.userName) {
      name = nameOrSocket.handshake.userName
    }

    return this.users.get(name)
  }

  _removeUser(userName) {
    this.users.del(userName)
    this.emit('userQuit', userName)
    return this
  }
}

export default function(nydus) {
  return new UserManager(nydus)
}
