module.exports = 'shieldbattery.sockets'

var mod = angular.module('shieldbattery.sockets', [])

mod.factory('siteSocket', function($rootScope) {
  return new AngularSocket(null, $rootScope)
})

mod.factory('psiSocket', function($rootScope) {
  return new AngularSocket('http://127.0.0.1:33198/site', $rootScope)
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

  if (!this.socket) {
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
  } else {
    this.socket.socket.reconnect()
  }

  return this
}

AngularSocket.prototype.disconnect = function() {
  if (!this.connected || !this.socket) return this

  this.socket.disconnect()
  return this
}

AngularSocket.prototype._onConnect = function() {
  console.log('socket connected.')
  this.connected = true
  this.scope.$apply()
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
    self.connected = false
    self.scope.$apply()
  }, 0)
}

// Unlike the normal socket.io API, this returns a function that can be used to remove the listener
AngularSocket.prototype.on = function(eventName, cb) {
  var self = this
  var wrappedCb = function() {
    cb.apply(self, arguments)
    self.scope.$apply()
  }

  var listener = { event: eventName, cb: wrappedCb }
  this._socketListeners.push(listener)
  if (this.socket) {
    this.socket.on(eventName, wrappedCb)
  }

  var removed = false
  return function() {
    if (removed) return
    removed = true
    self.socket.removeListener(eventName, wrappedCb)
    var index = self._socketListeners.indexOf(listener)
    if (index >= 0) self._socketListeners.splice(index, 1)
  }
}

// Unlike the normal socket.io API, this returns a function that can be used to remove the listener
AngularSocket.prototype.once = function(eventName, cb) {
  var self = this
  var wrappedCb = function() {
    cb.apply(self, arguments)
    self.scope.$apply()
  }

  var listener
  if (this.socket) {
    this.socket.once(eventName, wrappedCb)
  } else {
    listener = { event: eventName, cb: wrappedCb }
    this._socketOnceListeners.push(listener)
  }

  var removed = false
  return function() {
    if (removed) return
    removed = true
    self.socket.removeListener(eventName, wrappedCb)
    var index = self._socketOnceListeners.indexOf(listener)
    if (index >= 0) self._socketOnceListeners.splice(index, 1)
  }
}

AngularSocket.prototype.emit = function(eventName) {
  if (!this.socket) return this

  var self = this
    , args = Array.prototype.slice.apply(arguments)
  if (typeof arguments[arguments.length - 1] == 'function') {
    var cb = args[args.length - 1]
    args[args.length - 1] = function() {
      cb.apply(self, arguments)
      self.scope.$apply()
    }
  }

  this.socket.emit.apply(this.socket, args)
  return this
}
