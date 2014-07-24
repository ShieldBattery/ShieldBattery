var SimpleMap = require('../shared/simple-map')
  , EventEmitter = require('events').EventEmitter
  , inherits = require('util').inherits

module.exports = function(nydus) {
  return new UserManager(nydus)
}

inherits(UserManager, EventEmitter)
function UserManager(nydus) {
  EventEmitter.call(this)
  this.nydus = nydus
  this.users = new SimpleMap()

  var self = this
  this.nydus.on('connection', function(socket) {
    var userName = socket.handshake.userName
    if (!self.users.has(userName)) {
      var user = new UserSocketSet(self, userName, socket)
      self.users.put(userName, user)
      self.emit('newUser', user)

      user.once('disconnect', function() {
        self._removeUser(userName)
      })
    } else {
      self.users.get(userName).add(socket)
    }
  })

  this.nydus.router.subscribe('/users/:user', function(req, res) {
    if (req.socket.handshake.userName != req.params.user) {
      return res.fail(403, 'forbidden', { msg: 'You can only subscribe to your own user channel' })
    }

    res.complete()
    var user = self.get(req.socket)
    user.emit('subscribe', user, req.socket)
  })
}

UserManager.prototype.get = function(nameOrSocket) {
  var name
  if (typeof nameOrSocket == 'string') {
    name = nameOrSocket
  } else if (nameOrSocket && nameOrSocket.handshake && nameOrSocket.handshake.userName) {
    name = nameOrSocket.handshake.userName
  }

  return this.users.get(name)
}

UserManager.prototype._removeUser = function(userName) {
  this.users.del(userName)
  this.emit('userQuit', userName)
  return this
}

inherits(UserSocketSet, EventEmitter)
function UserSocketSet(manager, userName, initSocket) {
  EventEmitter.call(this)
  this.manager = manager
  this.userName = userName
  this._publishPath = '/users/' + encodeURIComponent(this.userName)
  this.sockets = initSocket ? [ initSocket ] : []

  var self = this
  if (initSocket) {
    initSocket.once('disconnect', function() {
      self.del(initSocket)
    })
  }
}

UserSocketSet.prototype.add = function(socket) {
  if (this.sockets.indexOf(socket) != -1) {
    return
  }

  this.sockets.push(socket)
  this.emit('connection', socket)
}

UserSocketSet.prototype.del = function(socket) {
  var index = this.sockets.indexOf(socket)
  if (index == -1) {
    return
  }

  this.sockets.splice(index, 1)
  if (!this.sockets.length) {
    this.emit('disconnect')
  }
}

UserSocketSet.prototype.publish = function(type, data) {
  this.manager.nydus.publish(this._publishPath, { type: type, data: data })
  return this
}

UserSocketSet.prototype.publishTo = function(socket, type, data) {
  socket.publish(this._publishPath, { type: type, data: data })
  return this
}

UserSocketSet.prototype.revoke = function(topicPath) {
  this.manager.nydus.revoke(this.sockets, topicPath)
}
