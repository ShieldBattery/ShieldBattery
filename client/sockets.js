module.exports = 'shieldbattery.sockets'
var io = require('socket.io-client')
  , nydus = require('nydus-client')

var mod = angular.module('shieldbattery.sockets', [])

mod.factory('siteSocket', function($rootScope) {
  return new AngularSocket(null, $rootScope)
})

mod.factory('psiSocket', function($rootScope) {
  return new AngularIoSocket('https://lifeoflively.net:33198/site', $rootScope)
})

function AngularSocket(host, $rootScope) {
  this.host = host
  this.scope = $rootScope
  this.connected = false
  this.lastError = null

  if (!this.host) {
    this.host = (location.protocol == 'https:' ? 'wss://' : 'ws://') + location.hostname
  }

  ;[ '_onConnect', '_onError', '_onDisconnect' ].forEach(function(func) {
    this[func] = this[func].bind(this)
  }, this)

  this._subscribeListeners = []

  var self = this
  ; [ 'call'
    , 'subscribe'
    , 'unsubscribe'
    , 'publish'
    // EventEmitter methods
    , 'on'
    , 'once'
    , 'removeListener'
    , 'removeAllListeners'
    , 'setMaxListeners'
    , 'listeners'
    ].forEach(function(func) {
    this[func] = function() {
      self.socket[func].apply(self.socket, arguments)
    }
  }, this)

  Object.defineProperty(this, 'router',
    { get: function() { return this.socket.router }
    , enumerable: true
    })
}

AngularSocket.prototype.connect = function() {
  if (this.connected) return this

  this.socket = nydus(this.host)
  this.socket.on('connect', this._onConnect)
    .on('error', this._onError)
    .on('disconnect', this._onDisconnect)

  var self = this
  this.socket.socket.on('message', function() {
    setTimeout(function() {
      self.scope.$apply()
    }, 0)
  })

  return this
}

// TODO(tec27): do we need a disconnect function for AngularSocket?

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

function AngularIoSocket(host, $rootScope) {
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

AngularIoSocket.prototype.connect = function() {
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

AngularIoSocket.prototype.disconnect = function() {
  if (!this.connected || !this.socket) return this

  this.socket.disconnect()
  return this
}

AngularIoSocket.prototype._onConnect = function() {
  console.log('socket connected.')
  this.connected = true
  this.scope.$apply()
}

AngularIoSocket.prototype._onError = function(err) {
  console.log('socket error!')
  console.dir(err)
  var self = this
  this.scope.$apply(function() {
    self.lastError = err
  })
}

AngularIoSocket.prototype._onDisconnect = function() {
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
AngularIoSocket.prototype.on = function(eventName, cb) {
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
AngularIoSocket.prototype.once = function(eventName, cb) {
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

AngularIoSocket.prototype.emit = function(eventName) {
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
