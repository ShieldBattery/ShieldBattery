module.exports = 'shieldbattery.sockets'
var nydus = require('nydus-client')

var mod = angular.module('shieldbattery.sockets', [])

mod.factory('siteSocket', function($rootScope) {
  return new AngularSocket(null, $rootScope)
})

mod.factory('psiSocket', function($rootScope) {
  return new AngularSocket('wss://lifeoflively.net:33198', $rootScope)
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

