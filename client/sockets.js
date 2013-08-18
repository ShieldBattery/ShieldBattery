module.exports = 'shieldbattery.sockets'

var mod = angular.module('shieldbattery.sockets', [])

mod.factory('siteSocket', function($rootScope) {
  return new AngularSocket(null, $rootScope)
})

function AngularSocket(host, $rootScope) {
  this.host = host
  this.scope = $rootScope
  this.connected = false
  this.lastError = null

  var self = this
  ;[ '_onConnect', '_onError', '_onDisconnect' ].forEach(function(func) {
    self[func] = self[func].bind(self)
  })

  this._socketListeners = []
  this._socketOnceListeners = []
}

AngularSocket.prototype.connect = function() {
  if (this.connected) return this

  this.socket = io.connect(this.host)
  this.socket.on('connect', this._onConnect)
    .on('error', this._onError)
    .on('disconnect', this._onDisconnect)

  var i, len
  for (i = 0, len = this._socketListeners.length; i < len; i++) {
    this.socket.on(this._socketListeners[i].event, this._socketListeners[i].cb)
  }
  for (i = 0, len = this._socketOnceListeners.length; i < len; i++) {
    this.socket.once(this._socketOnceListeners[i].event, this._socketOnceListeners[i].cb)
  }
  this._socketOnceListeners = []

  return this
}

AngularSocket.prototype.disconnect = function() {
  if (!this.connected || !this.socket) return this

  this.socket.disconnect()
  return this
}

AngularSocket.prototype._onConnect = function() {
  console.log('socket connected.')
  var self = this
  this.scope.$apply(function() {
    self.connected = true
  })
}

AngularSocket.prototype._onError = function(err) {
  console.log('socket error!')
  console.dir(err)
  var self = this
  this.scope.$apply(function() {
    self.lastError = err
  })
}

AngularSocket.prototype._onDisconnect = function() {
  console.log('socket disconnected.')
  var self = this
  // onDisconnect is called immediately (in the same event loop turn) if disconnected manually.
  // To prevent this from causing nested $digest loops, we defer $apply to the next turn.
  setTimeout(function() {
    self.scope.$apply(function() {
      self.connected = false
    })
  }, 0)
}

AngularSocket.prototype.on = function(eventName, cb) {
  var self = this
  var wrappedCb = function() {
    var args = arguments
    self.scope.$apply(function() {
      cb.apply(self.socket, args)
    })
  }

  this._socketListeners.push({ event: eventName, cb: wrappedCb })
  if (this.socket) {
    this.socket.on(eventName, wrappedCb)
  }
}

AngularSocket.prototype.once = function(eventName, cb) {
  var self = this
  var wrappedCb = function() {
    var args = arguments
    self.scope.$apply(function() {
      cb.apply(self.socket, args)
    })
  }

  if (this.socket) {
    this.socket.once(eventName, wrappedCb)
  } else {
    this._socketOnceListeners.push({ event: eventName, cb: wrappedCb })
  }
}

AngularSocket.prototype.emit = function(eventName, data, cb) {
  if (!this.socket) return this

  if (!cb) {
    this.socket.emit(eventName, data)
    return this
  }

  var self = this
  self.socket.emit(eventName, data, function() {
    var args = arguments
    self.scope.$apply(function() {
      cb.apply(self.socket, args)
    })
  })

  return this
}

AngularSocket.prototype.removeListener = function(eventName, cb) {
  for (var i = 0, len = this._socketListeners; i < len; i++) {
    var listener = this._socketListeners[i]
    if (listener.event == eventName && listener.cb == cb) {
      this._socketListeners.splice(i, 1)
      break
    }
  }

  if (this.socket) this.socket.removeListener(eventName, cb)

  return this
}
