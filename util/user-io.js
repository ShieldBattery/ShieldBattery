// Wrapper around socket.io that deals with sockets at the User level (e.g. you send/receive packets
// from Users, instead of the one or many connections they may currently have open to the server)
var SimpleMap = require('../shared/simple-map')
  , parser = require('socket.io').parser
  , EventEmitter = require('events').EventEmitter
  , util = require('util')

module.exports = function(io) {
  return new UserManager(io)
}

function UserManager(io) {
  this.io = io
  this.users = new SimpleMap()
  this.rooms = new SimpleMap()

  this.setFlags()

  var self = this
  this.io.sockets.on('connection', function(socket) {
    var userName = socket.handshake.userName
    if (!self.users.has(userName)) {
      var user = new UserSockets(self, userName, socket)
      self.users.put(userName, user)

      user.on('disconnect', function onUserDisconnect() {
        user.removeListener(onUserDisconnect)
        self._removeUser(userName)
      })
    } else {
      self.users.get(userName).add(socket)
    }

    socket.on('disconnect', function() {
      var user = self.users.get(userName)
      user.del(socket)
    })
  })

  io.users = this
}

UserManager.prototype.setFlags = function() {
  this.flags =  { targetRoom: null
                , exceptions: []
                }
  return this
}

UserManager.prototype._removeUser = function(userName) {
  if (!this.users.has(userName)) return this

  var user = this.users.get(userName)
    , rooms = user.rooms
  for (var i = 0, len = rooms.length; i < len; i++) {
    this.onLeave(user, rooms[i])
  }
  this.users.del(userName)

  return this
}

UserManager.prototype.in = UserManager.prototype.to = function(room) {
  this.flags.targetRoom = room || null
  return this
}

UserManager.prototype.except = function(userName) {
  this.flags.exceptions.push(userName)
  return this
}

UserManager.prototype.emit = function(name) {
  var flags = this.flags
    , packet =  { type: 'event'
                , name: name
                , args: Array.prototype.slice.call(arguments, 1)
                }
    , encoded = parser.encodePacket(packet)
  this.setFlags()

  if (!flags.targetRoom) {
    this.users.forEach(function(userName, userSockets) {
      if (flags.exceptions.indexOf(userName) != -1) return

      for (var i = 0, len = userSockets.sockets.length; i < len; i++) {
        userSockets.sockets[i].dispatch(encoded, false)
      }
    })

    return this
  }

  if (!this.rooms.has(flags.targetRoom)) {
    return this
  }

  var users = this.rooms.get(flags.targetRoom)
  for (var i = 0, len = users.length; i < len; i++) {
    var user = users[i]
    if (flags.exceptions.indexOf(user.name) != -1) continue

    for (var j = 0, sockLen = user.sockets.length; j < sockLen; j++) {
      user.sockets[j].dispatch(encoded, false)
    }
  }

  return this
}

UserManager.prototype.get = function(nameOrSocket) {
  var name
  if (typeof nameOrSocket == 'string') {
    name = nameOrSocket
  } else if (nameOrSocket && nameOrSocket.handshake && nameOrSocket.handshake.userName) {
    name = nameOrSocket.handshake.userName
  }

  if (this.users.has(name)) return this.users.get(name)
  else return new UserSockets(this, name)
}

UserManager.prototype.clients = function(room) {
  if (!this.rooms.has(room)) return []

  return this.rooms.get(room)
}

UserManager.prototype.onJoin = function(user, room) {
  if (!this.rooms.has(room)) {
    this.rooms.put(room, [ user ])
  } else {
    var roomList = this.rooms.get(room)
    if (roomList.indexOf(user) != -1) return
    roomList.push(user)
  }
}

UserManager.prototype.onLeave = function(user, room) {
  if (!this.rooms.has(room)) return

  var roomList = this.rooms.get(room)
    , index = roomList.indexOf(user)
  if (index != -1) {
    roomList.splice(index, 1)
  }
}

function UserSockets(manager, userName, firstSocket) {
  this.manager = manager
  this.name = userName
  this.sockets = firstSocket ? [ firstSocket ] : []
  this.rooms = []
  this.listeners = new SimpleMap()

  this.setFlags()
}
util.inherits(UserSockets, EventEmitter)

UserSockets.prototype.setFlags = function() {
  this.flags = { exceptions: [] }
  return this
}

UserSockets.prototype.except = function(socket) {
  this.flags.exceptions.push(socket)
  return this
}

UserSockets.prototype.add = function(socket) {
  if (this.sockets.indexOf(socket) == -1) {
    this.sockets.push(socket)

    this.listeners.forEach(function(name, cbs) {
      for (var i = 0, len = cbs.length; i < len; i++) {
        socket.on(name, cbs[i])
      }
    })

    this.$emit('connection', socket)
  }
}

UserSockets.prototype.del = function(socket) {
  // this function assumes the only reason for a socket to get removed is due to disconnect, and
  // therefore does not remove the event listeners we applied in #add.
  var index = this.sockets.indexOf(socket)
  if (index != -1) {
    this.sockets.splice(index, 1)
    if (!this.sockets.length) {
      this.$emit('disconnect')
    }
  }
}

UserSockets.prototype.join = function(room) {
  if (this.rooms.indexOf(room) == -1) {
    this.rooms.push(room)
    this.manager.onJoin(this, room)
  }

  return this
}

UserSockets.prototype.leave = function(room) {
  var index = this.rooms.indexOf(room)
  if (index != -1) {
    this.rooms.splice(index, 1)
    this.manager.onLeave(this, room)
  }

  return this
}

UserSockets.prototype.$emit = EventEmitter.prototype.emit
UserSockets.prototype.emit = function(name) {
  if (name == 'newListener') {
    return this.$emit.apply(this, arguments)
  }

  var i,
      len
  if (!this.flags.exceptions.length) {
    for (i = 0, len = this.sockets.length; i < len; i++) {
      this.sockets[i].emit.apply(this.sockets[i], arguments)
    }
  } else {
    for (i = 0, len = this.sockets.length; i < len; i++) {
      if (this.flags.exceptions.indexOf(this.sockets[i]) != -1) continue

      this.sockets[i].emit.apply(this.sockets[i], arguments)
    }
  }
  this.setFlags()
  return this
}

UserSockets.prototype.$on = EventEmitter.prototype.on
UserSockets.prototype.on = function(name, cb) {
  if (name == 'connection' || name == 'disconnect' || name == 'newListener') {
    return this.$on(name, cb)
  }

  if (this.listeners.has(name)) {
    this.listeners.get(name).push(cb)
  } else {
    this.listeners.put(name, [ cb ])
  }

  for (var i = 0, len = this.sockets.length; i < len; i++) {
    this.sockets[i].on(name, cb)
  }

  return this
}

UserSockets.prototype.$removeListener = EventEmitter.prototype.removeListener
UserSockets.prototype.removeListener = function(name, cb) {
  if (name == 'connection' || name == 'disconnect' || name == 'newListener') {
    return this.$removeListener(name, cb)
  } else if (!this.listeners.has(name)) {
    return this
  }

  var listeners = this.listeners.get(name)
    , index = listeners.indexOf(cb)
  if (index != -1) {
    if (listeners.length > 1) {
      listeners.splice(index, 1)
    } else {
      this.listeners.del(name)
    }
  }

  for (var i = 0, len = this.sockets.length; i < len; i++) {
    this.sockets[i].removeListener(name, cb)
  }

  return this
}
